import { UserRound } from 'lucide-react';
import { PageTitle, Badge } from '@tuheng/ui';
import type { Actor } from '@tuheng/domain';
import { ownProfile } from '../../../packages/infrastructure/src/profile';
import { AvatarEditor } from '../components/profile/AvatarEditor';
import { ProfileSettings } from '../components/profile/ProfileSettings';
import { Logout } from '../components/Actions';
import '../components/profile/account.css';

export async function ProfileView({ actor }: { actor: Actor }) {
  const profile = await ownProfile(actor);
  const role = {
    SITE_ADMIN: '网站管理员',
    SCHOOL_ADMIN: '学校管理员',
    TEACHER: '教师',
    STUDENT: '学生',
  }[profile.kind];
  return (
    <>
      <PageTitle title="用户中心" description="管理你的头像、账号安全和教学通知。" />
      <div className="profile-grid">
        <section className="panel profile-panel" aria-labelledby="profile-basics">
          <div className="profile-section-heading">
            <span className="account-section-icon">
              <UserRound size={20} aria-hidden="true" />
            </span>
            <h2 id="profile-basics">基本资料</h2>
          </div>
          <AvatarEditor
            name={profile.name}
            realm={profile.realm}
            version={profile.avatarAssetId}
            revision={profile.avatarRevision}
          />
          <dl className="profile-facts">
            <div>
              <dt>姓名</dt>
              <dd>{profile.name}</dd>
            </div>
            <div>
              <dt>当前身份</dt>
              <dd>
                <Badge>{role}</Badge>
              </dd>
            </div>
            <div>
              <dt>所属学校</dt>
              <dd>{profile.school ?? '平台账号'}</dd>
            </div>
            <div>
              <dt>{profile.kind === 'STUDENT' ? '学号' : '登录 ID'}</dt>
              <dd>{profile.studentNumber ?? profile.loginId ?? '—'}</dd>
            </div>
            <div>
              <dt>邮箱状态</dt>
              <dd>{profile.emailVerified ? '已验证' : '未绑定'}</dd>
            </div>
          </dl>
          <div className="profile-session">
            <Logout realm={profile.realm} className="button ghost" label="退出当前身份" />
          </div>
        </section>
        <ProfileSettings profile={profile} />
      </div>
    </>
  );
}
