"""add chart_draft table"""

revision = "002"
down_revision = "001"

from alembic import op
import sqlalchemy as sa


def upgrade():
    op.create_table(
        "chart_draft",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("sql_text", sa.Text(), nullable=False),
        sa.Column("datasource_id", sa.Integer(), nullable=True),
        sa.Column("chart_config", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["datasource_id"], ["datasource_config.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade():
    op.drop_table("chart_draft")
