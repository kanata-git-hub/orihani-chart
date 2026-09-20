import { readFileSync } from 'fs';
import { resolve } from 'path';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { after as afterAll, before as beforeAll, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));

let testEnv: any;
const PROJECT_ID = 'demo-security-chart';

const SUPER_ADMIN_AUTH = { sub: 'superadmin123', email: 'kanata840@gmail.com', email_verified: true };
const NORMAL_USER_AUTH = { sub: 'user123', email: 'normal@test.com', email_verified: true };
const NORMAL_ADMIN_AUTH = { sub: 'admin123', email: 'admin@test.com', email_verified: true };
const UNVERIFIED_USER_AUTH = { sub: 'unverified123', email: 'unverified@test.com', email_verified: false };

beforeAll(async () => {
  const rules = readFileSync(resolve(__dirname, 'firestore.rules'), 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Firestore Rules', () => {
  it('prevents unspecified paths from being read', async () => {
    const unauthedDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(unauthedDb.collection('some_random_path').get());
  });

  describe('users collection', () => {
    it('allows super admin to create a user', async () => {
      const db = testEnv.authenticatedContext(SUPER_ADMIN_AUTH.sub, SUPER_ADMIN_AUTH).firestore();
      await assertSucceeds(db.collection('users').doc('newuser@test.com').set({
        email: 'newuser@test.com',
        role: 'user'
      }));
    });

    it('denies normal user from creating a user', async () => {
      const db = testEnv.authenticatedContext(NORMAL_USER_AUTH.sub, NORMAL_USER_AUTH).firestore();
      await assertFails(db.collection('users').doc('hacker@test.com').set({
        email: 'hacker@test.com',
        role: 'admin'
      }));
    });

    it('allows users to read their own document', async () => {
      await testEnv.withSecurityRulesDisabled(async (context: any) => {
        const db = context.firestore();
        await db.collection('users').doc(NORMAL_USER_AUTH.email).set({ email: NORMAL_USER_AUTH.email, role: 'user' });
      });
      const db = testEnv.authenticatedContext(NORMAL_USER_AUTH.sub, NORMAL_USER_AUTH).firestore();
      await assertSucceeds(db.collection('users').doc(NORMAL_USER_AUTH.email).get());
    });

    it('denies users from reading others documents if not admin', async () => {
      await testEnv.withSecurityRulesDisabled(async (context: any) => {
        const db = context.firestore();
        await db.collection('users').doc('somebody@test.com').set({ email: 'somebody@test.com', role: 'user' });
      });
      const db = testEnv.authenticatedContext(NORMAL_USER_AUTH.sub, NORMAL_USER_AUTH).firestore();
      await assertFails(db.collection('users').doc('somebody@test.com').get());
    });
    
    it('allows delegated admins to list and delete users', async () => {
      await testEnv.withSecurityRulesDisabled(async (context: any) => {
        const db = context.firestore();
        await db.collection('users').doc(NORMAL_ADMIN_AUTH.email).set({ email: NORMAL_ADMIN_AUTH.email, role: 'admin' });
        await db.collection('users').doc('other@test.com').set({ email: 'other@test.com', role: 'user' });
      });
      const db = testEnv.authenticatedContext(NORMAL_ADMIN_AUTH.sub, NORMAL_ADMIN_AUTH).firestore();
      // Should be able to list
      await assertSucceeds(db.collection('users').get());
      // Should be able to add
      await assertSucceeds(db.collection('users').doc('third@test.com').set({ email: 'third@test.com', role: 'user' }));
      // Should be able to delete
      await assertSucceeds(db.collection('users').doc('other@test.com').delete());
    });
  });
});
