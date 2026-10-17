"""Optional real-browser smoke test. Requires running localhost app + Playwright."""
import json
import os
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    # Direct connection is for localhost only, avoiding proxy routing of local UI.
    health = httpx.get("http://127.0.0.1:8501/_stcore/health", trust_env=False)
    assert health.status_code == 200
    with sync_playwright() as p:
        args = {"headless": True}
        if os.getenv("BROWSER_EXECUTABLE"):
            args["executable_path"] = os.environ["BROWSER_EXECUTABLE"]
        if os.name != "nt":
            args["args"] = ["--no-sandbox", "--disable-dev-shm-usage"]
        browser = p.chromium.launch(**args)
        page = browser.new_page(viewport={"width": 1600, "height": 1050})
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.goto("http://127.0.0.1:8501", wait_until="networkidle")
        page.get_by_text("画法几何及机械制图 · AI 作业批改", exact=False).first.wait_for()
        page.screenshot(path=str(ROOT / "docs/ui_initial.png"), full_page=True)
        page.get_by_text("Mock 流程测试（固定响应）", exact=True).click()
        for index, role in enumerate(["question", "reference", "student"]):
            page.locator('input[type="file"]').nth(index).set_input_files(str(ROOT / f"sample_data/{role}.png"))
        page.get_by_role("button", name="分析题目与标准答案", exact=True).click()
        page.get_by_role("button", name="确认以上题意、知识点与评分细则", exact=True).wait_for(timeout=30000)
        page.get_by_role("button", name="确认以上题意、知识点与评分细则", exact=True).click()
        page.get_by_role("button", name="开始 Mock 流程测试（非真实批改）", exact=True).click()
        page.get_by_text("逐项评分", exact=True).wait_for(timeout=30000)
        page.locator('[data-testid="stMetric"]').first.wait_for(timeout=15000)
        # Components arrive in separate render updates; wait for the exact score.
        page.get_by_text("5.5", exact=True).first.wait_for(timeout=15000)
        metrics = page.locator('[data-testid="stMetric"]').all_text_contents()
        assert "5.5" in "".join(metrics)
        page.get_by_text("MOCK 固定样例 · 未执行视觉推理 · 分数不代表上传图片的真实表现", exact=True).evaluate(
            "el => el.scrollIntoView({block: 'start'})")
        page.screenshot(path=str(ROOT / "docs/ui_report.png"))
        assert not errors
        result = {"health_status": health.status_code, "browser_console_errors": errors,
                  "flow": ["Mock selected", "actual upload into all 3 roles", "analysis", "teacher confirmed", "mock grading"],
                  "metrics": metrics, "real_api_called": False}
        (ROOT / "docs/browser_check.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False))
        browser.close()


if __name__ == "__main__":
    main()
