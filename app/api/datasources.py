"""数据源管理 API"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..models import DatasourceConfig, get_session
from ..services.metadata_schedule_service import serialize_metadata_schedule, update_metadata_schedule

router = APIRouter()


def get_db():
    """获取数据库会话依赖"""
    db = get_session()
    try:
        yield db
    finally:
        db.close()


def _metadata_schedule_api_fields(ds: DatasourceConfig) -> dict:
    schedule = serialize_metadata_schedule(ds)
    return {
        **schedule,
        "metadata_schedule_enabled": schedule["enabled"],
        "metadata_schedule_interval_minutes": schedule["interval_minutes"],
        "metadata_schedule_time": schedule["schedule_time"],
        "metadata_next_run_at": schedule["next_run_at"],
        "metadata_last_scheduled_at": schedule["last_scheduled_at"],
        "metadata_last_schedule_status": schedule["last_schedule_status"],
    }


@router.post("/test-connection")
def test_connection(
    ds_type: str = Query("oracle", description="数据源类型"),
    host: str = Query(..., description="主机地址"),
    port: int = Query(1521, description="端口"),
    service_name: str = Query(None, description="Service Name"),
    username: str = Query(..., description="用户名"),
    password: str = Query(None, description="密码"),
):
    """测试数据源连通性（不保存到数据库）"""
    config = {
        "host": host,
        "port": port,
        "service_name": service_name,
        "username": username,
        "password": password or "",
        "lib_dir": None,
    }

    if ds_type == "oracle":
        try:
            from ..adapters.oracle import OracleAdapter
            adapter = OracleAdapter(config)
            ok = adapter.test_connection()
            adapter.close()
            if ok:
                return {"success": True, "message": "连接成功"}
            else:
                return {"success": False, "message": "无法连接到数据库，请检查配置"}
        except Exception as e:
            return {"success": False, "message": f"连接失败: {str(e)}"}
    else:
        raise HTTPException(status_code=400, detail=f"不支持的数据库类型: {ds_type}")


@router.get("/")
def list_datasources(db: Session = Depends(get_db)):
    """列出所有数据源"""
    dses = db.query(DatasourceConfig).order_by(DatasourceConfig.id).all()
    return [
        {
            "id": ds.id,
            "name": ds.name,
            "ds_type": ds.ds_type,
            "host": ds.host,
            "port": ds.port,
            "service_name": ds.service_name,
            "username": ds.username,
            "dialect": ds.dialect,
            "schema_names": ds.schema_names,
            "is_active": ds.is_active,
            "created_at": str(ds.created_at),
            **_metadata_schedule_api_fields(ds),
        }
        for ds in dses
    ]


@router.get("/{ds_id}")
def get_datasource(ds_id: int, db: Session = Depends(get_db)):
    """获取单个数据源"""
    ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == ds_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="数据源不存在")
    return {
        "id": ds.id,
        "name": ds.name,
        "ds_type": ds.ds_type,
        "host": ds.host,
        "port": ds.port,
        "service_name": ds.service_name,
        "username": ds.username,
        "dialect": ds.dialect,
        "schema_names": ds.schema_names,
        "is_active": ds.is_active,
        "created_at": str(ds.created_at),
        "updated_at": str(ds.updated_at),
        **_metadata_schedule_api_fields(ds),
    }


@router.post("/")
def create_datasource(
    name: str = Query(..., description="数据源名称"),
    ds_type: str = Query("oracle", description="数据源类型"),
    host: str = Query(..., description="主机地址"),
    port: int = Query(1521, description="端口"),
    service_name: str = Query(None, description="Service Name"),
    username: str = Query(..., description="用户名"),
    password: str = Query(None, description="密码（明文，将由后端加密）"),
    dialect: str = Query("oracle", description="SQL 方言"),
    schema_names: str = Query(None, description="关注 Schema（逗号分隔）"),
    metadata_schedule_enabled: bool = Query(False, description="Enable automatic metadata collection"),
    metadata_schedule_interval_minutes: int = Query(1440, description="Metadata collection interval in minutes"),
    metadata_schedule_time: str = Query(None, description="Daily fixed collection time HH:MM"),
    db: Session = Depends(get_db),
):
    """创建数据源（阶段1：密码明文接收，后续接入加密）"""
    ds = DatasourceConfig(
        name=name,
        ds_type=ds_type,
        host=host,
        port=port,
        service_name=service_name,
        username=username,
        password_enc=password,  # TODO: 接入 cryptography.fernet 加密
        dialect=dialect,
        schema_names=schema_names,
        metadata_schedule_enabled=metadata_schedule_enabled,
        metadata_schedule_interval_minutes=metadata_schedule_interval_minutes,
        metadata_schedule_time=metadata_schedule_time,
    )
    db.add(ds)
    try:
        db.flush()
        if metadata_schedule_enabled:
            update_metadata_schedule(
                ds.id,
                {
                    "enabled": metadata_schedule_enabled,
                    "interval_minutes": metadata_schedule_interval_minutes,
                    "schedule_time": metadata_schedule_time,
                },
                db=db,
            )
        db.commit()
        db.refresh(ds)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    return {"id": ds.id, "message": "数据源创建成功"}


@router.put("/{ds_id}/metadata-schedule")
def update_datasource_metadata_schedule(
    ds_id: int,
    enabled: bool = Query(..., description="Enable automatic metadata collection"),
    interval_minutes: int = Query(1440, description="Metadata collection interval in minutes"),
    schedule_time: str = Query(None, description="Daily fixed collection time HH:MM"),
):
    try:
        schedule = update_metadata_schedule(
            ds_id,
            {"enabled": enabled, "interval_minutes": interval_minutes, "schedule_time": schedule_time},
        )
        return {
            **schedule,
            "metadata_schedule_enabled": schedule["enabled"],
            "metadata_schedule_interval_minutes": schedule["interval_minutes"],
            "metadata_schedule_time": schedule["schedule_time"],
            "metadata_next_run_at": schedule["next_run_at"],
            "metadata_last_scheduled_at": schedule["last_scheduled_at"],
            "metadata_last_schedule_status": schedule["last_schedule_status"],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{ds_id}")
def delete_datasource(ds_id: int, db: Session = Depends(get_db)):
    """删除数据源"""
    ds = db.query(DatasourceConfig).filter(DatasourceConfig.id == ds_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="数据源不存在")
    db.delete(ds)
    db.commit()
    return {"message": "数据源已删除"}


@router.post("/{ds_id}/test-connection")
def test_existing_datasource_connection(ds_id: int):
    """测试已保存数据源的连通性"""
    from ..services.datasource_service import test_datasource_connection
    try:
        ok = test_datasource_connection(ds_id)
        if ok:
            return {"success": True, "message": "连接成功"}
        else:
            return {"success": False, "message": "无法连接到数据库，请检查配置"}
    except Exception as e:
        return {"success": False, "message": f"连接失败: {e}"}
