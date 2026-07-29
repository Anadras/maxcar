import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const STATE_PATH = join(tmpdir(), 'maxcar-e2e-state.json');

export interface E2EState {
  userId: string;
  email: string;
  password: string;
}
