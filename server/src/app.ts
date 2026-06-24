import express from 'express';
import cors from 'cors';
import { aiRouter } from './api/ai.js';
import { storyRouter } from './api/story.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.use('/api/ai', aiRouter);
app.use('/api/ai', storyRouter);

app.listen(PORT, () => {
  console.log(`[mmPla] Server running on http://localhost:${PORT}`);
});
