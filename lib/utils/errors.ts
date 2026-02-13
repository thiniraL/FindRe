import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export type ApiError = {
  message: string;
  code?: string;
  statusCode: number;
};

export class AppError extends Error {
  statusCode: number;
  code?: string;

  constructor(message: string, statusCode: number = 500, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'AppError';
  }
}

export function createErrorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          message: 'Validation error',
          code: 'VALIDATION_ERROR',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      { status: 400 }
    );
  }

  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          message: error.message,
          code: error.code,
        },
      },
      { status: error.statusCode }
    );
  }

  // Log unexpected errors
  console.error('Unexpected error:', error);

  return NextResponse.json(
    {
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
    },
    { status: 500 }
  );
}

export function createSuccessResponse<T>(
  data: T,
  status: number = 200
): NextResponse {
  return NextResponse.json({ data }, { status });
}

export function createPaginatedResponse<T>(
  data: T[],
  page: number,
  limit: number,
  total?: number | null
): NextResponse {
  const pagination: { page: number; limit: number; total?: number; totalPages?: number } = {
    page,
    limit,
  };
  if (total != null && total >= 0) {
    pagination.total = total;
    pagination.totalPages = Math.ceil(total / limit);
  }
  return NextResponse.json({
    data,
    pagination,
  });
}




