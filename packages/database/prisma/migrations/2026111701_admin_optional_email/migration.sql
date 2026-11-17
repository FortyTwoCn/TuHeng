-- Root setup now completes after the first password change. Preserve credentials,
-- verified mailboxes and every other account kind, including unfinished root setup.
UPDATE "User"
SET "installationComplete" = true
WHERE "kind" = 'SITE_ADMIN'
  AND "mustChangePassword" = false
  AND "installationComplete" = false;
