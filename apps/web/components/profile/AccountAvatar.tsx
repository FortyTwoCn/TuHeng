import type { AuthRealm } from '@tuheng/contracts';
import { avatarHref } from '../../lib/resource-links';

export function AccountAvatar({
  name,
  realm,
  version,
  large = false,
}: {
  name: string;
  realm: AuthRealm;
  version?: string | null;
  large?: boolean;
}) {
  return (
    <span className={'account-avatar' + (large ? ' account-avatar-large' : '')} aria-hidden="true">
      <span>{Array.from(name)[0] ?? '图'}</span>
      {version && <img src={avatarHref(version, realm, large ? 'large' : 'small')} alt="" />}
    </span>
  );
}
