from streamlit.testing.v1 import AppTest

from tests.conftest import ROOT


def button(app, label):
    return next(b for b in app.button if b.label == label)


def checkbox(app, label):
    return next(c for c in app.checkbox if c.label == label)


def mock_app(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("OPENAI_MODEL", "")
    app = AppTest.from_file(str(ROOT / "app.py"), default_timeout=40).run()
    app.sidebar.radio[0].set_value("Mock 流程测试（固定响应）").run()
    checkbox(app, "未上传区域使用程序生成样例").check().run()
    return app


def test_ui_missing_api_can_preprocess_and_requires_confirmation(monkeypatch):
    app = mock_app(monkeypatch)
    assert not app.exception
    assert button(app, "开始 Mock 流程测试（非真实批改）").disabled
    button(app, "分析题目与标准答案").click().run()
    assert not app.exception
    assert button(app, "开始 Mock 流程测试（非真实批改）").disabled
    button(app, "确认以上题意、知识点与评分细则").click().run()
    assert not button(app, "开始 Mock 流程测试（非真实批改）").disabled
    button(app, "开始 Mock 流程测试（非真实批改）").click().run()
    assert not app.exception
    assert app.session_state["report"].total_score == 5.5
    assert any(m.value == "5.5" for m in app.metric)
    assert app.session_state["report"].model_metadata.is_mock
    # Changes to source materials must invalidate both confirmation and report.
    next(t for t in app.text_area if t.label == "教师补充题目文字").set_value("题目条件发生变化").run()
    assert "report" not in app.session_state and "confirmed" not in app.session_state


def test_ui_edited_invalid_rubric_blocks_grading(monkeypatch):
    app = mock_app(monkeypatch)
    button(app, "分析题目与标准答案").click().run()
    button(app, "确认以上题意、知识点与评分细则").click().run()
    next(t for t in app.text_area if t.label == "可编辑评分细则 JSON").set_value("[]").run()
    assert not app.exception
    assert button(app, "开始 Mock 流程测试（非真实批改）").disabled
    assert "confirmed" not in app.session_state
