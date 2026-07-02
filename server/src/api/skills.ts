import { Router, Request, Response } from 'express';
import { loadAllSkills } from '../services/skillService.js';

export const skillsRouter = Router();

skillsRouter.get('/', (req: Request, res: Response) => {
  const skills = loadAllSkills();
  res.json({
    skills: skills.map(s => ({
      name: s.name,
      description: s.description,
      path: s.path,
      category: s.category,
      keywords: s.keywords,
    })),
  });
});
