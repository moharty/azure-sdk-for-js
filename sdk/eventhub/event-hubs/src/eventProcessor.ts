// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import uuid from "uuid/v4";
import { EventHubClient } from "./impl/eventHubClient";
import { PumpManager, PumpManagerImpl } from "./pumpManager";
import { AbortController, AbortSignalLike } from "@azure/abort-controller";
import { logger, logErrorStackTrace } from "./log";
import { FairPartitionLoadBalancer, PartitionLoadBalancer } from "./partitionLoadBalancer";
import { PartitionProcessor, Checkpoint } from "./partitionProcessor";
import { SubscriptionEventHandlers } from "./eventHubConsumerClientModels";
import { EventPosition, latestEventPosition } from "./eventPosition";
import { delayWithoutThrow } from "./util/delayWithoutThrow";
import { CommonEventProcessorOptions } from "./models/private";
import { CloseReason } from "./models/public";

/**
 * An interface representing the details on which instance of a `EventProcessor` owns processing
 * of a given partition from a consumer group of an Event Hub instance.
 *
 * **Note**: This is used internally by the `EventProcessor` and user never has to create it directly.
 */
export interface PartitionOwnership {
  /**
   * @property The fully qualified Event Hubs namespace. This is likely to be similar to
   * <yournamespace>.servicebus.windows.net
   */
  fullyQualifiedNamespace: string;
  /**
   * @property The event hub name
   */
  eventHubName: string;
  /**
   * @property The consumer group name
   */
  consumerGroup: string;
  /**
   * @property The identifier of the Event Hub partition.
   */
  partitionId: string;
  /**
   * @property The unique identifier of the event processor.
   */
  ownerId: string;
  /**
   * @property The last modified time.
   */
  lastModifiedTimeInMs?: number;
  /**
   * @property The unique identifier for the operation.
   */
  etag?: string;
}

/**
 * A checkpoint store stores and retrieves partition ownership information and checkpoint details
 * for each partition in a given consumer group of an event hub instance.
 *
 * Users are not meant to implement an `CheckpointStore`.
 * Users are expected to choose existing implementations of this interface, instantiate it, and pass
 * it to the `EventHubConsumerClient` class constructor when instantiating a client.
 * Users are not expected to use any of the methods on a checkpoint store, these are used internally by
 * the client.
 *
 * Implementations of `CheckpointStore` can be found on npm by searching for packages with the prefix &commat;azure/eventhub-checkpointstore-.
 */
export interface CheckpointStore {
  /**
   * Called to get the list of all existing partition ownership from the underlying data store. Could return empty
   * results if there are is no existing ownership information.
   *
   * @param fullyQualifiedNamespace The fully qualified Event Hubs namespace. This is likely to be similar to
   * <yournamespace>.servicebus.windows.net.
   * @param eventHubName The event hub name.
   * @param consumerGroup The consumer group name.
   * @return A list of partition ownership details of all the partitions that have/had an owner.
   */
  listOwnership(
    fullyQualifiedNamespace: string,
    eventHubName: string,
    consumerGroup: string
  ): Promise<PartitionOwnership[]>;
  /**
   * Called to claim ownership of a list of partitions. This will return the list of partitions that were owned
   * successfully.
   *
   * @param partitionOwnership The list of partition ownership this instance is claiming to own.
   * @return A list of partitions this instance successfully claimed ownership.
   */
  claimOwnership(partitionOwnership: PartitionOwnership[]): Promise<PartitionOwnership[]>;

  /**
   * Updates the checkpoint in the data store for a partition.
   *
   * @param checkpoint The checkpoint.
   */
  updateCheckpoint(checkpoint: Checkpoint): Promise<void>;

  /**
   * Lists all the checkpoints in a data store for a given namespace, eventhub and consumer group.
   *
   * @param fullyQualifiedNamespace The fully qualified Event Hubs namespace. This is likely to be similar to
   * <yournamespace>.servicebus.windows.net.
   * @param eventHubName The event hub name.
   * @param consumerGroup The consumer group name.
   */
  listCheckpoints(
    fullyQualifiedNamespace: string,
    eventHubName: string,
    consumerGroup: string
  ): Promise<Checkpoint[]>;
}

/**
 * A set of options to pass to the constructor of `EventProcessor`.
 * You can specify
 * - `maxBatchSize`: The max size of the batch of events passed each time to user code for processing.
 * - `maxWaitTimeInSeconds`: The maximum amount of time to wait to build up the requested message count before
 * passing the data to user code for processing. If not provided, it defaults to 60 seconds.
 *
 * Example usage with default values:
 * ```ts
 * {
 *     maxBatchSize: 1,
 *     maxWaitTimeInSeconds: 60,
 * }
 * ```
 * @internal
 * @ignore
 */
export interface FullEventProcessorOptions extends CommonEventProcessorOptions {
  /**
   * An optional pump manager to use, rather than instantiating one internally
   * @internal
   * @ignore
   */
  pumpManager?: PumpManager;
}

/**
 * Event Processor based applications consist of one or more instances of EventProcessor which have been
 * configured to consume events from the same Event Hub and consumer group. They balance the
 * workload across different instances by distributing the partitions to be processed among themselves.
 * They also allow the user to track progress when events are processed using checkpoints.
 *
 * A checkpoint is meant to represent the last successfully processed event by the user from a particular
 * partition of a consumer group in an Event Hub instance.
 *
 * You need the below to create an instance of `EventProcessor`
 * - The name of the consumer group from which you want to process events
 * - An instance of `EventHubClient` class that was created for the Event Hub instance.
 * - A user implemented class that extends the `PartitionProcessor` class. To get started, you can use the
 * base class `PartitionProcessor` which simply logs the incoming events. To provide your code to process incoming
 * events, extend this class and override the `processEvents()` method. For example:
 * ```js
 * class SamplePartitionProcessor extends PartitionProcessor {
 *     async processEvents(events) {
 *        // user code to process events here
 *        // Information on the partition being processed is available as properties on the `SamplePartitionProcessor` class
 *        // use `this.updateCheckpoint()` method to update checkpoints as needed
 *     }
 * }
 * ```
 * - An instance of `CheckpointStore`. See &commat;azure/eventhubs-checkpointstore-blob for an implementation.
 * For production, choose an implementation that will store checkpoints and partition ownership details to a durable store.
 * Implementations of `CheckpointStore` can be found on npm by searching for packages with the prefix &commat;azure/eventhub-checkpointstore-.
 *
 * @class EventProcessor
 * @internal
 * @ignore
 */
export class EventProcessor {
  private _consumerGroup: string;
  private _processorOptions: FullEventProcessorOptions;
  private _pumpManager: PumpManager;
  private _id: string;
  private _isRunning: boolean = false;
  private _loopTask?: PromiseLike<void>;
  private _abortController?: AbortController;
  private _processingTarget: PartitionLoadBalancer | string;
  private _loopIntervalInMs = 10000;
  private _inactiveTimeLimitInMs = 60000;

  /**
   * @param consumerGroup The name of the consumer group from which you want to process events.
   * @param eventHubClient An instance of `EventHubClient` that was created for the Event Hub instance.
   * @param PartitionProcessorClass A user-provided class that extends the `PartitionProcessor` class.
   * This class will be responsible for processing and checkpointing events.
   * @param checkpointStore An instance of `CheckpointStore`. See &commat;azure/eventhubs-checkpointstore-blob for an implementation.
   * For production, choose an implementation that will store checkpoints and partition ownership details to a durable store.
   * @param options A set of options to configure the Event Processor
   * - `maxBatchSize`         : The max size of the batch of events passed each time to user code for processing.
   * - `maxWaitTimeInSeconds` : The maximum amount of time to wait to build up the requested message count before
   * passing the data to user code for processing. If not provided, it defaults to 60 seconds.
   */
  constructor(
    consumerGroup: string,
    private _eventHubClient: EventHubClient,
    private _subscriptionEventHandlers: SubscriptionEventHandlers,
    private _checkpointStore: CheckpointStore,
    options: FullEventProcessorOptions
  ) {
    if (options.ownerId) {
      this._id = options.ownerId;
      logger.verbose(`Starting event processor with ID ${this._id}`);
    } else {
      this._id = uuid();
      logger.verbose(`Starting event processor with autogenerated ID ${this._id}`);
    }

    this._consumerGroup = consumerGroup;
    this._processorOptions = options;
    this._pumpManager =
      options.pumpManager || new PumpManagerImpl(this._id, this._processorOptions);
    const inactiveTimeLimitInMS = options.inactiveTimeLimitInMs || this._inactiveTimeLimitInMs;
    this._processingTarget =
      options.processingTarget || new FairPartitionLoadBalancer(inactiveTimeLimitInMS);
    if (options.loopIntervalInMs) {
      this._loopIntervalInMs = options.loopIntervalInMs;
    }
  }

  /**
   * The unique identifier for the EventProcessor.
   *
   * @return {string}
   */
  get id(): string {
    return this._id;
  }

  private _createPartitionOwnershipRequest(
    partitionOwnershipMap: Map<string, PartitionOwnership>,
    partitionIdToClaim: string
  ): PartitionOwnership {
    const previousPartitionOwnership = partitionOwnershipMap.get(partitionIdToClaim);
    const partitionOwnership: PartitionOwnership = {
      ownerId: this._id,
      partitionId: partitionIdToClaim,
      fullyQualifiedNamespace: this._eventHubClient.fullyQualifiedNamespace,
      consumerGroup: this._consumerGroup,
      eventHubName: this._eventHubClient.eventHubName,
      etag: previousPartitionOwnership ? previousPartitionOwnership.etag : undefined
    };

    return partitionOwnership;
  }

  /*
   * Claim ownership of the given partition if it's available
   */
  private async _claimOwnership(ownershipRequest: PartitionOwnership): Promise<void> {
    logger.info(
      `[${this._id}] Attempting to claim ownership of partition ${ownershipRequest.partitionId}.`
    );
    try {
      const claimedOwnerships = await this._checkpointStore.claimOwnership([ownershipRequest]);

      // can happen if the partition was claimed out from underneath us - we shouldn't
      // attempt to spin up a processor.
      if (!claimedOwnerships.length) {
        return;
      }

      logger.info(
        `[${this._id}] Successfully claimed ownership of partition ${ownershipRequest.partitionId}.`
      );

      await this._startPump(ownershipRequest.partitionId);
    } catch (err) {
      logger.warning(
        `[${this.id}] Failed to claim ownership of partition ${ownershipRequest.partitionId}`
      );
      logErrorStackTrace(err);
      await this._handleSubscriptionError(err);
    }
  }

  private async _startPump(partitionId: string) {
    if (this._pumpManager.isReceivingFromPartition(partitionId)) {
      logger.verbose(
        `[${this._id}] There is already an active partitionPump for partition "${partitionId}", skipping pump creation.`
      );
      return;
    }

    logger.verbose(
      `[${this._id}] [${partitionId}] Calling user-provided PartitionProcessorFactory.`
    );

    const partitionProcessor = new PartitionProcessor(
      this._subscriptionEventHandlers,
      this._checkpointStore,
      {
        fullyQualifiedNamespace: this._eventHubClient.fullyQualifiedNamespace,
        eventHubName: this._eventHubClient.eventHubName,
        consumerGroup: this._consumerGroup,
        partitionId: partitionId,
        eventProcessorId: this.id
      }
    );

    const eventPosition = await this._getStartingPosition(partitionId);
    await this._pumpManager.createPump(eventPosition, this._eventHubClient, partitionProcessor);

    logger.verbose(`[${this._id}] PartitionPump created successfully.`);
  }

  private async _getStartingPosition(partitionIdToClaim: string): Promise<EventPosition> {
    const availableCheckpoints = await this._checkpointStore.listCheckpoints(
      this._eventHubClient.fullyQualifiedNamespace,
      this._eventHubClient.eventHubName,
      this._consumerGroup
    );

    const validCheckpoints = availableCheckpoints.filter(
      (chk) => chk.partitionId === partitionIdToClaim
    );

    if (validCheckpoints.length > 0) {
      return { offset: validCheckpoints[0].offset };
    }

    logger.verbose(
      `No checkpoint found for partition ${partitionIdToClaim}. Looking for fallback.`
    );
    return getStartPosition(partitionIdToClaim, this._processorOptions.startPosition);
  }

  private async _runLoopForSinglePartition(
    partitionId: string,
    abortSignal: AbortSignalLike
  ): Promise<void> {
    while (!abortSignal.aborted) {
      try {
        await this._startPump(partitionId);
      } catch (err) {
        logger.warning(`[${this._id}] An error occured within the EventProcessor loop: ${err}`);
        logErrorStackTrace(err);
        await this._handleSubscriptionError(err);
      } finally {
        // sleep for some time after which we can attempt to create a pump again.
        logger.verbose(
          `[${this._id}] Pausing the EventProcessor loop for ${this._loopIntervalInMs} ms.`
        );
        // swallow errors from delay since it's fine for delay to exit early
        await delayWithoutThrow(this._loopIntervalInMs, abortSignal);
      }
    }
  }

  /**
   * Every loop to this method will result in this EventProcessor owning at most one new partition.
   *
   * The load is considered balanced when no active EventProcessor owns 2 partitions more than any other active
   * EventProcessor. Given that each invocation to this method results in ownership claim of at most one partition,
   * this algorithm converges gradually towards a steady state.
   *
   * When a new partition is claimed, this method is also responsible for starting a partition pump that creates an
   * EventHubConsumer for processing events from that partition.
   */

  private async _runLoopWithLoadBalancing(
    loadBalancer: PartitionLoadBalancer,
    abortSignal: AbortSignalLike
  ): Promise<void> {
    // periodically check if there is any partition not being processed and process it
    while (!abortSignal.aborted) {
      try {
        const partitionOwnershipMap: Map<string, PartitionOwnership> = new Map();
        // Retrieve current partition ownership details from the datastore.
        const partitionOwnership = await this._checkpointStore.listOwnership(
          this._eventHubClient.fullyQualifiedNamespace,
          this._eventHubClient.eventHubName,
          this._consumerGroup
        );

        const abandonedMap: Map<string, PartitionOwnership> = new Map();

        for (const ownership of partitionOwnership) {
          if (isAbandoned(ownership)) {
            abandonedMap.set(ownership.partitionId, ownership);
            continue;
          }

          partitionOwnershipMap.set(ownership.partitionId, ownership);
        }
        const partitionIds = await this._eventHubClient.getPartitionIds({
          abortSignal: abortSignal
        });

        if (abortSignal.aborted) {
          return;
        }

        if (partitionIds.length > 0) {
          const partitionsToClaim = loadBalancer.loadBalance(
            this._id,
            partitionOwnershipMap,
            partitionIds
          );
          if (partitionsToClaim) {
            for (const partitionToClaim of partitionsToClaim) {
              let ownershipRequest: PartitionOwnership;

              if (abandonedMap.has(partitionToClaim)) {
                ownershipRequest = this._createPartitionOwnershipRequest(
                  abandonedMap,
                  partitionToClaim
                );
              } else {
                ownershipRequest = this._createPartitionOwnershipRequest(
                  partitionOwnershipMap,
                  partitionToClaim
                );
              }

              await this._claimOwnership(ownershipRequest);
            }
          }
        }
      } catch (err) {
        logger.warning(`[${this._id}] An error occured within the EventProcessor loop: ${err}`);
        logErrorStackTrace(err);
        await this._handleSubscriptionError(err);
      } finally {
        // sleep for some time, then continue the loop again.
        logger.verbose(
          `[${this._id}] Pausing the EventProcessor loop for ${this._loopIntervalInMs} ms.`
        );
        // swallow the error since it's fine to exit early from delay
        await delayWithoutThrow(this._loopIntervalInMs, abortSignal);
      }
    }
  }

  /**
   * This is called when there are errors that are not specific to a partition (ex: load balancing)
   */
  private async _handleSubscriptionError(err: Error): Promise<void> {
    // filter out any internal "expected" errors
    if (err.name === "AbortError") {
      return;
    }

    if (this._subscriptionEventHandlers.processError) {
      try {
        await this._subscriptionEventHandlers.processError(err, {
          fullyQualifiedNamespace: this._eventHubClient.fullyQualifiedNamespace,
          eventHubName: this._eventHubClient.eventHubName,
          consumerGroup: this._consumerGroup,
          partitionId: "",
          updateCheckpoint: async () => {}
        });
      } catch (err) {
        logger.verbose(
          `[${this._id}] An error was thrown from the user's processError handler: ${err}`
        );
      }
    }
  }

  /**
   * Starts the `EventProcessor`. Based on the number of instances of `EventProcessor` that are running for the
   * same consumer group, the partitions are distributed among these instances to process events.
   *
   * For each partition, the user provided `PartitionProcessor` is instantiated.
   *
   * Subsequent calls to start will be ignored if this event processor is already running.
   * Calling `start()` after `stop()` is called will restart this event processor.
   *
   * @return {void}
   */
  start(): void {
    if (this._isRunning) {
      logger.verbose(`[${this._id}] Attempted to start an already running EventProcessor.`);
      return;
    }

    this._isRunning = true;
    this._abortController = new AbortController();
    logger.verbose(`[${this._id}] Starting an EventProcessor.`);

    if (targetWithoutOwnership(this._processingTarget)) {
      logger.verbose(`[${this._id}] Single partition target: ${this._processingTarget}`);
      this._loopTask = this._runLoopForSinglePartition(
        this._processingTarget,
        this._abortController.signal
      );
    } else {
      logger.verbose(`[${this._id}] Multiple partitions, using load balancer`);
      this._loopTask = this._runLoopWithLoadBalancing(
        this._processingTarget,
        this._abortController.signal
      );
    }
  }

  isRunning() {
    return this._isRunning;
  }

  /**
   * Stops processing events for all partitions owned by this event processor.
   * All `PartitionProcessor` will be shutdown and any open resources will be closed.
   *
   * Subsequent calls to stop will be ignored if the event processor is not running.
   *
   */
  async stop(): Promise<void> {
    logger.verbose(`[${this._id}] Stopping an EventProcessor.`);
    if (this._abortController) {
      // cancel the event processor loop
      this._abortController.abort();
    }

    this._isRunning = false;
    try {
      // remove all existing pumps
      await this._pumpManager.removeAllPumps(CloseReason.Shutdown);

      // waits for the event processor loop to complete
      // will complete immediately if _loopTask is undefined
      if (this._loopTask) {
        await this._loopTask;
      }
    } catch (err) {
      logger.verbose(`[${this._id}] An error occured while stopping the EventProcessor: ${err}`);
    } finally {
      logger.verbose(`[${this._id}] EventProcessor stopped.`);
    }

    if (targetWithoutOwnership(this._processingTarget)) {
      logger.verbose(`[${this._id}] No partitions owned, skipping abandoning.`);
    } else {
      await this.abandonPartitionOwnerships();
    }
  }

  private async abandonPartitionOwnerships() {
    logger.verbose(`[${this._id}] Abandoning owned partitions`);
    const allOwnerships = await this._checkpointStore.listOwnership(
      this._eventHubClient.fullyQualifiedNamespace,
      this._eventHubClient.eventHubName,
      this._consumerGroup
    );
    const ourOwnerships = allOwnerships.filter((ownership) => ownership.ownerId === this._id);
    // unclaim any partitions that we currently own
    for (const ownership of ourOwnerships) {
      ownership.ownerId = "";
    }
    return this._checkpointStore.claimOwnership(ourOwnerships);
  }
}

function isAbandoned(ownership: PartitionOwnership): boolean {
  return ownership.ownerId === "";
}

function getStartPosition(
  partitionIdToClaim: string,
  startPositions?: EventPosition | { [partitionId: string]: EventPosition }
): EventPosition {
  if (startPositions == null) {
    return latestEventPosition;
  }

  if (
    startPositions.offset != undefined ||
    startPositions.sequenceNumber != undefined ||
    startPositions.enqueuedOn != undefined
  ) {
    return startPositions;
  }

  const startPosition = (startPositions as { [partitionId: string]: EventPosition })[
    partitionIdToClaim
  ];

  if (startPosition == null) {
    return latestEventPosition;
  }

  return startPosition;
}

function targetWithoutOwnership(target: PartitionLoadBalancer | string): target is string {
  return typeof target === "string";
}
