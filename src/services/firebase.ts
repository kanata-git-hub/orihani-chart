import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, 'ai-studio-b2c282bc-7bca-4b2d-91b0-5a1e4c383e0a');
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets.readonly');

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(_error: unknown, operationType: OperationType, _path: string | null): never {
  console.warn('Firestore operation failed:', operationType);
  throw new Error('데이터베이스 요청에 실패했습니다. 로그인 상태와 권한을 확인해주세요.');
}
