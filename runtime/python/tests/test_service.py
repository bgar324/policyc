from policyc_runtime.service import app


def test_fastapi_exposes_required_run_routes():
    routes = {(route.path, method) for route in app.routes for method in getattr(route, "methods", set())}
    assert ("/runs", "POST") in routes
    assert ("/runs/{run_id}", "GET") in routes
    assert ("/runs/{run_id}/events", "GET") in routes
    assert ("/runs/{run_id}/cancel", "POST") in routes
    assert ("/runs/{run_id}/report", "GET") in routes
