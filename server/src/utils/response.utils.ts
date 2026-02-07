import type { Response } from 'express';

/**
 * Response utilities for consistent API responses
 */

interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  message?: string;
  timestamp: string;
}

interface ErrorResponse {
  success: false;
  error: string;
  details?: unknown;
  timestamp: string;
}

/**
 * Send a success response
 */
export const resSuccess = <T>(
  res: Response,
  data: T,
  statusCode: number = 200,
  message?: string
): void => {
  const response: SuccessResponse<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  res.status(statusCode).json(response);
};

/**
 * Send an error response
 */
export const resError = (
  res: Response,
  error: string,
  statusCode: number = 500,
  details?: unknown
): void => {
  const response: ErrorResponse = {
    success: false,
    error,
    details,
    timestamp: new Date().toISOString(),
  };
  res.status(statusCode).json(response);
};
