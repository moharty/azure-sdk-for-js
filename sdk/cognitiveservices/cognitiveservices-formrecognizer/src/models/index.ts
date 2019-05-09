/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *
 * Code generated by Microsoft (R) AutoRest Code Generator.
 * Changes may cause incorrect behavior and will be lost if the code is regenerated.
 */


import * as msRest from "@azure/ms-rest-js";

/**
 * Contract to initiate a train request.
 */
export interface TrainRequest {
  /**
   * Get or set source path.
   */
  source: string;
}

/**
 * An interface representing FormDocumentReport.
 */
export interface FormDocumentReport {
  /**
   * Reference to the data that the report is for.
   */
  documentName?: string;
  /**
   * Total number of pages trained on.
   */
  pages?: number;
  /**
   * List of errors per page.
   */
  errors?: string[];
  /**
   * Status of the training operation. Possible values include: 'success', 'partialSuccess',
   * 'failure'
   */
  status?: Status;
}

/**
 * Error reported during an operation.
 */
export interface FormOperationError {
  /**
   * Message reported during the train operation.
   */
  errorMessage?: string;
}

/**
 * Response of the Train API call.
 */
export interface TrainResult {
  /**
   * Identifier of the model.
   */
  modelId?: string;
  /**
   * List of documents used to train the model and the
   * train operation error reported by each.
   */
  trainingDocuments?: FormDocumentReport[];
  /**
   * Errors returned during the training operation.
   */
  errors?: FormOperationError[];
}

/**
 * Result of an operation to get
 * the keys extracted by a model.
 */
export interface KeysResult {
  /**
   * Object mapping ClusterIds to Key lists.
   */
  clusters?: { [propertyName: string]: string[] };
}

/**
 * Result of a model status query operation.
 */
export interface ModelResult {
  /**
   * Get or set model identifier.
   */
  modelId?: string;
  /**
   * Get or set the status of model. Possible values include: 'created', 'ready', 'invalid'
   */
  status?: Status1;
  /**
   * Get or set the created date time of the model.
   */
  createdDateTime?: Date;
  /**
   * Get or set the model last updated datetime.
   */
  lastUpdatedDateTime?: Date;
}

/**
 * Result of query operation to fetch multiple models.
 */
export interface ModelsResult {
  /**
   * Collection of models.
   */
  modelsProperty?: ModelResult[];
}

/**
 * An interface representing InnerError.
 */
export interface InnerError {
  requestId?: string;
}

/**
 * An interface representing ErrorInformation.
 */
export interface ErrorInformation {
  code?: string;
  innerError?: InnerError;
  message?: string;
}

/**
 * An interface representing ErrorResponse.
 */
export interface ErrorResponse {
  error?: ErrorInformation;
}

/**
 * Canonical representation of single extracted text.
 */
export interface ExtractedToken {
  /**
   * String value of the extracted text.
   */
  text?: string;
  /**
   * Bounding box of the extracted text. Represents the
   * location of the extracted text as a pair of
   * cartesian co-ordinates. The co-ordinate pairs are arranged by
   * top-left, top-right, bottom-right and bottom-left endpoints box
   * with origin reference from the bottom-left of the page.
   */
  boundingBox?: number[];
  /**
   * A measure of accuracy of the extracted text.
   */
  confidence?: number;
}

/**
 * Representation of a key-value pair as a list
 * of key and value tokens.
 */
export interface ExtractedKeyValuePair {
  /**
   * List of tokens for the extracted key in a key-value pair.
   */
  key?: ExtractedToken[];
  /**
   * List of tokens for the extracted value in a key-value pair.
   */
  value?: ExtractedToken[];
}

/**
 * Extraction information of a column in
 * a table.
 */
export interface ExtractedTableColumn {
  /**
   * List of extracted tokens for the column header.
   */
  header?: ExtractedToken[];
  /**
   * Extracted text for each cell of a column. Each cell
   * in the column can have a list of one or more tokens.
   */
  entries?: ExtractedToken[][];
}

/**
 * Extraction information about a table
 * contained in a page.
 */
export interface ExtractedTable {
  /**
   * Table identifier.
   */
  id?: string;
  /**
   * List of columns contained in the table.
   */
  columns?: ExtractedTableColumn[];
}

/**
 * Extraction information of a single page in a
 * with a document.
 */
export interface ExtractedPage {
  /**
   * Page number.
   */
  number?: number;
  /**
   * Height of the page (in pixels).
   */
  height?: number;
  /**
   * Width of the page (in pixels).
   */
  width?: number;
  /**
   * Cluster identifier.
   */
  clusterId?: number;
  /**
   * List of Key-Value pairs extracted from the page.
   */
  keyValuePairs?: ExtractedKeyValuePair[];
  /**
   * List of Tables and their information extracted from the page.
   */
  tables?: ExtractedTable[];
}

/**
 * Analyze API call result.
 */
export interface AnalyzeResult {
  /**
   * Status of the analyze operation. Possible values include: 'success', 'partialSuccess',
   * 'failure'
   */
  status?: Status2;
  /**
   * Page level information extracted in the analyzed
   * document.
   */
  pages?: ExtractedPage[];
  /**
   * List of errors reported during the analyze
   * operation.
   */
  errors?: FormOperationError[];
}

/**
 * Optional Parameters.
 */
export interface FormRecognizerClientAnalyzeWithCustomModelOptionalParams extends msRest.RequestOptionsBase {
  /**
   * An optional list of known keys to extract the values for.
   */
  keys?: string[];
}

/**
 * Defines values for Status.
 * Possible values include: 'success', 'partialSuccess', 'failure'
 * @readonly
 * @enum {string}
 */
export type Status = 'success' | 'partialSuccess' | 'failure';

/**
 * Defines values for Status1.
 * Possible values include: 'created', 'ready', 'invalid'
 * @readonly
 * @enum {string}
 */
export type Status1 = 'created' | 'ready' | 'invalid';

/**
 * Defines values for Status2.
 * Possible values include: 'success', 'partialSuccess', 'failure'
 * @readonly
 * @enum {string}
 */
export type Status2 = 'success' | 'partialSuccess' | 'failure';

/**
 * Contains response data for the trainCustomModel operation.
 */
export type TrainCustomModelResponse = TrainResult & {
  /**
   * The underlying HTTP response.
   */
  _response: msRest.HttpResponse & {
      /**
       * The response body as text (string format)
       */
      bodyAsText: string;

      /**
       * The response body as parsed JSON or XML
       */
      parsedBody: TrainResult;
    };
};

/**
 * Contains response data for the getExtractedKeys operation.
 */
export type GetExtractedKeysResponse = KeysResult & {
  /**
   * The underlying HTTP response.
   */
  _response: msRest.HttpResponse & {
      /**
       * The response body as text (string format)
       */
      bodyAsText: string;

      /**
       * The response body as parsed JSON or XML
       */
      parsedBody: KeysResult;
    };
};

/**
 * Contains response data for the getCustomModels operation.
 */
export type GetCustomModelsResponse = ModelsResult & {
  /**
   * The underlying HTTP response.
   */
  _response: msRest.HttpResponse & {
      /**
       * The response body as text (string format)
       */
      bodyAsText: string;

      /**
       * The response body as parsed JSON or XML
       */
      parsedBody: ModelsResult;
    };
};

/**
 * Contains response data for the getCustomModel operation.
 */
export type GetCustomModelResponse = ModelResult & {
  /**
   * The underlying HTTP response.
   */
  _response: msRest.HttpResponse & {
      /**
       * The response body as text (string format)
       */
      bodyAsText: string;

      /**
       * The response body as parsed JSON or XML
       */
      parsedBody: ModelResult;
    };
};

/**
 * Contains response data for the analyzeWithCustomModel operation.
 */
export type AnalyzeWithCustomModelResponse = AnalyzeResult & {
  /**
   * The underlying HTTP response.
   */
  _response: msRest.HttpResponse & {
      /**
       * The response body as text (string format)
       */
      bodyAsText: string;

      /**
       * The response body as parsed JSON or XML
       */
      parsedBody: AnalyzeResult;
    };
};