# Security Specification — CipherLink E2EE Firestore Rules

## 1. Data Invariants
1. **Default-Deny Catch-All**: All paths not explicitly matched are denied for both `read` and `write`.
2. **Verified Identity**: All write operations require `request.auth != null && request.auth.token.email_verified == true`.
3. **Path Variable Hardening (`isValidId`)**: Every document ID path variable (`{userId}`, `{contactId}`, `{requestId}`, `{groupId}`, `{memberUid}`, `{messageId}`) on single-document operations (`get`, `create`, `update`, `delete`) must satisfy `id is string && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$')`.
4. **UserProfile (`/users/{userId}`)**:
   - Only the authenticated owner (`request.auth.uid == userId`) with verified email can create or update their own public profile.
   - Zero PII (`email`, `phone`, `address`) is stored in `/users/{userId}`.
   - Immutable fields on update: `uid`, `createdAt`.
5. **ContactEntry (`/users/{userId}/contacts/{contactId}`)**:
   - Relational Master Gate: Parent `/users/$(userId)` must exist.
   - Only `request.auth.uid == userId` can read or write their own contact list.
6. **ContactRequest (`/contactRequests/{requestId}`)**:
   - On `create`: `fromUid == request.auth.uid`, `fromUid != toUid`, `status == 'pending'`, and both `/users/$(fromUid)` and `/users/$(toUid)` must exist.
   - On `update`: Terminal State Locking prevents updating a request once `existing().status != 'pending'`. Only the recipient (`toUid == request.auth.uid`) can transition `status` from `'pending'` to `'accepted'` or `'declined'` using `affectedKeys().hasOnly(['status', 'updatedAt'])`.
   - On `list`/`get`: Restricted strictly to `resource.data.fromUid == request.auth.uid || resource.data.toUid == request.auth.uid`.
7. **ChatGroup (`/groups/{groupId}`) & Subcollections (`/members/{memberUid}`, `/messages/{messageId}`)**:
   - On `create` group: `creatorUid == request.auth.uid`, and Atomicity Guarantee (`existsAfter`) requires the creator's `/groups/$(groupId)/members/$(request.auth.uid)` document to exist after the batch/write.
   - Subcollection Master Gate: Reading or writing `/groups/{groupId}/messages/{messageId}` or `/groups/{groupId}/members/{memberUid}` requires the caller to be a current member via `exists(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid))`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Shadow Field Injection on Profile Create**: `{ uid: "u1", ..., isAdmin: true }` -> Rejected by `hasOnly`.
2. **Identity Spoofing on Profile Create**: Authenticated as `u1`, writing `/users/u2` with `uid: "u2"` -> Rejected by `userId == request.auth.uid`.
3. **Unverified Email Spoof**: Authenticated user with `email_verified: false` attempting profile write -> Rejected by `isVerifiedUser()`.
4. **Oversized String DoS ("Denial of Wallet")**: `username` of 5,000 chars -> Rejected by `data.username.size() <= 50`.
5. **Path ID Poisoning**: Creating `/contactRequests/bad$id!@#` -> Rejected by `isValidId(requestId)`.
6. **Self-Accepted Contact Request**: Sender `u1` creates `/contactRequests/req1` with `status: 'accepted'` -> Rejected by `incoming().status == 'pending'`.
7. **Sender Hijacking Contact Request Acceptance**: Sender `u1` updates `/contactRequests/req1` to `status: 'accepted'` -> Rejected because only `existing().toUid == request.auth.uid` can accept.
8. **Terminal State Re-opening**: Recipient updates an already `'declined'` contact request back to `'accepted'` -> Rejected by Terminal State Lock (`existing().status == 'pending'`).
9. **Timestamp Forgery**: Client passes forged past `createdAt` or `updatedAt` instead of `request.time` -> Rejected by `incoming().createdAt == request.time`.
10. **Orphaned Group Creation Without Owner Membership**: Creating `/groups/g1` without atomically creating `/groups/g1/members/$(request.auth.uid)` -> Rejected by `existsAfter`.
11. **Non-Member Group Message Injection**: User `u3` (not in `/groups/g1/members/u3`) writes to `/groups/g1/messages/m1` -> Rejected by Master Gate `isGroupMember(groupId)`.
12. **Unauthorized Blanket List Scraping**: Querying `/contactRequests` without filtering by `fromUid == request.auth.uid` or `toUid == request.auth.uid` -> Rejected by `allow list` check on `resource.data`.
