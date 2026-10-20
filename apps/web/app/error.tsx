'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="workspace">
      <section className="panel">
        <h1>暂时无法加载</h1>
        <p>数据服务可能暂时不可用。已保存的提交不会因刷新而丢失。</p>
        <button className="button primary" onClick={reset}>
          重试加载
        </button>
      </section>
    </main>
  );
}
