import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import multer from 'multer';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  void next;
  if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') {
    res.status(413).json({ error: 'The request exceeds the endpoint size limit.' });
    return;
  }
  if (error instanceof multer.MulterError) {
    res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error:
        error.code === 'LIMIT_FILE_SIZE'
          ? 'Keep voice summaries below 10 MB.'
          : 'The audio upload is invalid. Record a short summary or use text.',
    });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'Please check the entered values.', details: error.flatten() });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      res.status(409).json({
        error: 'A record with these details already exists. Please use the existing record.',
      });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({ error: 'The requested record was not found.' });
      return;
    }
  }
  // Keep customer responses generic and log details server-side.
  console.error('Unhandled API error', error);

  res.status(500).json({
    error: 'Internal server error',
  });
}
