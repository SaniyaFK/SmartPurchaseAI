"""Helper script to copy the ML_02 CSV into the data folder and then run training."""
import shutil
import os
import sys

base = os.path.dirname(os.path.abspath(__file__))
ml_service_dir = os.path.join(base, "VibeCode-main", "VibeCode", "ml-service")
data_dir = os.path.join(ml_service_dir, "data")
os.makedirs(data_dir, exist_ok=True)

src_csv = os.path.join(base, "ML_02_spending_forecasting.csv")
dst_csv = os.path.join(data_dir, "ML_02_spending_forecasting.csv")

if os.path.exists(src_csv):
    shutil.copy2(src_csv, dst_csv)
    print(f"✅ Copied {src_csv} → {dst_csv}")
else:
    print(f"❌ Source not found: {src_csv}")
    sys.exit(1)

# Now run training
sys.path.insert(0, ml_service_dir)
os.chdir(ml_service_dir)
exec(open(os.path.join(ml_service_dir, "training", "train_spending_model.py")).read())
