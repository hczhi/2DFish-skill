import { Router, Request, Response } from 'express';
import { readFile, writeFile, deleteFile, listFiles, searchFiles } from '../services/fileService.js';

export const filesRouter = Router();

filesRouter.get('/read', (req: Request, res: Response) => {
  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path is required' }); return; }

  try {
    const userId = req.user!.id;
    const content = readFile(filePath, userId);
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
    const userId = req.user!.id;
    writeFile(filePath, content, userId);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

filesRouter.delete('/', (req: Request, res: Response) => {
  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: 'path is required' }); return; }

  try {
    const userId = req.user!.id;
    deleteFile(filePath, userId);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

filesRouter.get('/list', (req: Request, res: Response) => {
  const dirPath = (req.query.path as string) || '';
  try {
    const userId = req.user!.id;
    const files = listFiles(dirPath, userId);
    res.json({ files });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

filesRouter.get('/search', (req: Request, res: Response) => {
  const query = req.query.q as string;
  if (!query) { res.status(400).json({ error: 'q is required' }); return; }

  const userId = req.user!.id;
  const results = searchFiles(query, userId);
  res.json({ results });
});
