"""File-backed MCP tools for the Project Baltic demo."""

from pathlib import Path

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("Bianka")
CASE_FILES = Path(__file__).resolve().parents[1] / "case_files"


def _read_file(filename: str) -> str:
    return (CASE_FILES / filename).read_bytes().decode("utf-8")


@mcp.tool()
def get_customer_contract_c014() -> str:
    """Retrieve the complete customer contract excerpts for C014."""
    return _read_file("01_Customer_Contract_C014.txt")


@mcp.tool()
def get_merger_review_excerpts() -> str:
    """Retrieve the complete merger review excerpts."""
    return _read_file("02_Merger_Review_Excerpts.txt")


@mcp.tool()
def get_customer_revenue() -> str:
    """Retrieve the full confidential customer revenue CSV as text."""
    return _read_file("03_Customer_Revenue_CONFIDENTIAL.csv")


@mcp.tool()
def get_management_accounts() -> str:
    """Retrieve the full confidential management accounts CSV as text."""
    return _read_file("04_Management_Accounts_CONFIDENTIAL.csv")


@mcp.tool()
def get_hr_payroll() -> str:
    """Retrieve the full restricted HR payroll CSV as text."""
    return _read_file("05_HR_Payroll_RESTRICTED.csv")


@mcp.tool()
def get_hr_aggregate() -> str:
    """Retrieve the full allowed HR aggregate JSON as text."""
    return _read_file("06_HR_Aggregate_ALLOWED.json")


@mcp.tool()
def get_kyc_details() -> str:
    """Retrieve the full restricted KYC JSON as text."""
    return _read_file("07_KYC_RESTRICTED.json")


@mcp.tool()
def get_kyc_status() -> str:
    """Retrieve the full allowed KYC status JSON as text."""
    return _read_file("08_KYC_Status_ALLOWED.json")


@mcp.tool()
def get_third_party_note() -> str:
    """Retrieve the complete third-party note injection-test fixture."""
    return _read_file("09_Third_Party_Note_INJECTION_TEST.txt")


@mcp.tool()
def get_technical_appendix() -> str:
    """Retrieve the complete technical appendix secret-test fixture."""
    return _read_file("10_Technical_Appendix_SECRET_TEST.txt")


if __name__ == "__main__":
    mcp.run(transport="stdio")
