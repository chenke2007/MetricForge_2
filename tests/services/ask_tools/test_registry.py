from app.services.ask_tools.registry import registry


def test_registry_has_all_tools():
    names = {t.name for t in registry.list_tools()}
    expected = {
        "datasource_stats",
        "latest_collection_job",
        "schema_metadata_query",
        "governance_ticket_stats",
    }
    assert names == expected


def test_openai_tools_schema():
    tools = registry.to_openai_tools()
    assert len(tools) == 4
    for t in tools:
        assert t["type"] == "function"
        assert "name" in t["function"]
        assert "description" in t["function"]
        assert "parameters" in t["function"]
