"""
Text Preprocessor for ML-01 Purchase Category Classification.
Combines textual purchase attributes (product name, brand, merchant, description, purchase type)
into a unified cleaned string for TF-IDF vectorization.
"""

def clean_text(value: str) -> str:
    """Normalize string input: strip whitespace, handle nulls, and convert to lower case."""
    if value is None or (isinstance(value, float) and str(value) == 'nan'):
        return ""
    return str(value).strip().lower()

def create_combined_text_feature(row) -> str:
    """
    Combines fields into a single text representation for classification.
    Supports both pandas Series/dict and direct field values.
    """
    if hasattr(row, 'get'):
        product_name = clean_text(row.get('product_name') or row.get('productName') or '')
        brand = clean_text(row.get('brand') or '')
        merchant = clean_text(row.get('merchant') or row.get('storeName') or '')
        description = clean_text(row.get('description') or row.get('rawOcrText') or '')
        purchase_type = clean_text(row.get('purchase_type') or row.get('purchaseType') or '')
    else:
        product_name = clean_text(getattr(row, 'product_name', ''))
        brand = clean_text(getattr(row, 'brand', ''))
        merchant = clean_text(getattr(row, 'merchant', ''))
        description = clean_text(getattr(row, 'description', ''))
        purchase_type = clean_text(getattr(row, 'purchase_type', ''))

    tokens = [product_name, brand, merchant, description, purchase_type]
    combined = " ".join([t for t in tokens if t])
    return combined
