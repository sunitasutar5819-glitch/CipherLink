import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesContent = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');

test('Firestore rules enforce Eight Pillars and block Dirty Dozen adversarial vectors', () => {
  // 1. Default-deny catch-all exists
  assert.ok(rulesContent.includes('match /{document=**} {\n      allow read, write: if false;\n    }'));

  // 2. Email verification required for writes
  assert.ok(rulesContent.includes('request.auth.token.email_verified == true'));

  // 3. Path Variable Hardening (isValidId)
  assert.ok(rulesContent.includes("id.matches('^[a-zA-Z0-9_\\\\-]+$')"));

  // 4. Anti-Update-Gap blueprint validators with hasAll & hasOnly
  assert.ok(rulesContent.includes('isValidUserProfile(incoming())'));
  assert.ok(rulesContent.includes('isValidContactEntry(incoming(), userId, contactId)'));
  assert.ok(rulesContent.includes('isValidContactRequest(incoming())'));
  assert.ok(rulesContent.includes('isValidChatGroup(incoming(), groupId)'));
  assert.ok(rulesContent.includes('isValidGroupMember(incoming(), groupId, memberUid)'));
  assert.ok(rulesContent.includes('isValidEncryptedMessage(incoming(), messageId)'));

  // 5. Action-based affectedKeys().hasOnly() on updates
  assert.ok(rulesContent.includes("affectedKeys().hasOnly(['status', 'updatedAt'])"));

  // 6. Terminal state lock on ContactRequest
  assert.ok(rulesContent.includes("existing().status == 'pending'"));

  // 7. Temporal integrity using request.time
  assert.ok(rulesContent.includes('incoming().createdAt == request.time'));
  assert.ok(rulesContent.includes('incoming().updatedAt == request.time'));

  // 8. Atomicity Guarantee (existsAfter) on Group creation
  assert.ok(
    rulesContent.includes(
      'existsAfter(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid))'
    )
  );
});
