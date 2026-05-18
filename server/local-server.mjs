import { createServer } from 'node:http';
import { handleApiRequest } from './handler.mjs';

const port = Number(process.env.PORT ?? 4300);

createServer(handleApiRequest).listen(port, () => {
  console.log(`Cheabs Live Scoring API listening at http://localhost:${port}`);
});
