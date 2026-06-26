# tests/services/ask_tools/test_tools.py
import pytest

from app.models import (
    DatasourceConfig,
    GovernanceTicket,
    MetadataCollectionJob,
    TableMetadata,
    ColumnMetadata,
)
from app.services.ask_tools.tools import (
    datasource_stats,
    latest_collection_job,
    schema_metadata_query,
    governance_ticket_stats,
)


@pytest.fixture
def sample_datasource(db_session):
    ds = DatasourceConfig(
        name="核心 Oracle",
        ds_type="oracle",
        is_active=True,
        host="localhost",
        port=1521,
        username="system",
        dialect="oracle",
    )
    db_session.add(ds)
    db_session.commit()
    return ds


@pytest.fixture
def sample_table(db_session, sample_datasource):
    t = TableMetadata(
        datasource_id=sample_datasource.id,
        schema_name="LEASE",
        table_name="CONTRACT",
        table_comment="合同表",
    )
    db_session.add(t)
    db_session.commit()
    db_session.refresh(t)
    col = ColumnMetadata(
        table_id=t.id,
        column_name="CONTRACT_ID",
        column_type="NUMBER",
        is_primary_key=True,
    )
    db_session.add(col)
    db_session.commit()
    return t


@pytest.mark.asyncio
async def test_datasource_stats(db_session, sample_datasource):
    result = await datasource_stats(db_session)
    assert result["total"] == 1
    assert result["active"] == 1
    assert result["items"][0]["name"] == "核心 Oracle"


@pytest.mark.asyncio
async def test_latest_collection_job(db_session, sample_datasource):
    job = MetadataCollectionJob(
        datasource_id=sample_datasource.id,
        status="success",
        tables_count=10,
        columns_count=100,
    )
    db_session.add(job)
    db_session.commit()
    result = await latest_collection_job(db_session)
    assert result["status"] == "success"
    assert result["tables_count"] == 10


@pytest.mark.asyncio
async def test_schema_metadata_query(db_session, sample_table):
    result = await schema_metadata_query(db_session, keyword="合同")
    assert len(result["tables"]) == 1
    assert result["tables"][0]["table_name"] == "CONTRACT"


@pytest.mark.asyncio
async def test_governance_ticket_stats(db_session):
    t = GovernanceTicket(
        ticket_type="missing_semantic",
        title="缺失语义",
        status="open",
    )
    db_session.add(t)
    db_session.commit()
    result = await governance_ticket_stats(db_session)
    assert result["total"] == 1
    assert result["by_status"]["open"] == 1
