import { Router, Request, Response } from 'express';
import { readFile, writeFile, deleteFile, listFiles, searchFiles } from '../services/fileService.js';

export const filesRouter = Router();

filesRouter.get('/read', (req: Request, res: Response) => {
  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path is required' }); return; }

  try {
    const content = readFile(filePath);
    res.json({ content });
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

filesRouter.post('/write', (req: Request, res: Response) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined) {
    res.status(400).json({ error: 'path and content are required' });
    return;
  }

  try {
    writeFile(filePath, content);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

filesRouter.delete('/', (req: Request, res: Response) => {
  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path is required' }); return; }

  try {
    deleteFile(filePath);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

filesRouter.get('/list', (req: Request, res: Response) => {
  const dirPath = (req.query.path as string) || '';
  try {
    const files = listFiles(dirPath);
    res.json({ files });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

filesRouter.get('/search', (req: Request, res: Response) => {
  const query = req.query.q as string;
  if (!query) { res.status(400).json({ error: 'q is required' }); return; }

  const results = searchFiles(query);
  res.json({ results });
});
