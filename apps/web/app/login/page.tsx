import Link from 'next/link';
import { BrandLogo } from '../../components/BrandLogo';
export default function LoginChoice() {
  return (
    <main className="identity-entry">
      <BrandLogo />
      <h1>登录图衡</h1>
      <p>请选择本次使用的账号身份。</p>
      <div className="identity-choices">
        <Link className="identity-choice" href="/login/student">
          <h2>学生</h2>
          <p>学号、已绑定邮箱或邮箱验证码</p>
        </Link>
        <Link className="identity-choice" href="/login/staff">
          <h2>教师与管理</h2>
          <p>教师、学校管理和站点管理员</p>
        </Link>
      </div>
    </main>
  );
}
