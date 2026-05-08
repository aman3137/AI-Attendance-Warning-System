import pandas as pd
import json
from datetime import datetime, time

try:
    # Load data from Google Sheets
    sheet1_url = "https://docs.google.com/spreadsheets/d/1yzJiY6ghIcSfvIl6e8sTtbM51nfac3X4jFZvJZdtZaA/export?format=csv&gid=0"
    processed_url = "https://docs.google.com/spreadsheets/d/1yzJiY6ghIcSfvIl6e8sTtbM51nfac3X4jFZvJZdtZaA/export?format=csv&gid=1386553414"

    print("Fetching data from Google Sheets...")
    df_sheet1 = pd.read_csv(sheet1_url)
    df_processed = pd.read_csv(processed_url)
    print("Data fetched successfully.")

    # Generate JSON for employees
    employees_list = []
    for idx, row in df_sheet1.iterrows():
        emp_id = row['Employee ID']
        # Find last warning date from df_processed
        emp_processed = df_processed[(df_processed['Employee ID'] == emp_id) & (df_processed['Is Late'] == 'Yes')]
        last_warning = None
        if not emp_processed.empty:
            last_warning = emp_processed['Date'].max()
            
        employees_list.append({
            "employeeId": emp_id,
            "name": row['Employee Name'],
            "lateCount": int(row['Strike Count']) if not pd.isna(row['Strike Count']) else 0,
            "lastWarningDate": last_warning if pd.notna(last_warning) else None,
            "month": "May 2026"
        })

    # Today's Records (Assuming Sheet 1 represents current day status)
    today_records = []
    today = datetime.now().strftime('%Y-%m-%d')
    for idx, row in df_sheet1.iterrows():
        check_in = row['Check-in Time']
        is_late_flag = "NO"
        if pd.notna(check_in):
            try:
                t_obj = datetime.strptime(check_in, '%H:%M:%S').time()
                if t_obj > time(11, 0, 0):
                    is_late_flag = "YES"
            except:
                pass
                
        today_records.append({
            "employeeId": row['Employee ID'],
            "name": row['Employee Name'],
            "date": today,
            "checkIn": str(check_in) if pd.notna(check_in) else "—",
            "checkOut": str(row['Check-out Time']) if pd.notna(row['Check-out Time']) else "—",
            "lateFlag": is_late_flag
        })

    # Warnings
    warnings = []
    warn_df = df_processed[df_processed['Action Taken'] == 'Warning Sent']
    for idx, row in warn_df.iterrows():
        lc = int(row['Strike Count']) if pd.notna(row['Strike Count']) else 1
        level = min(lc, 4)
        msg = ""
        if level == 1: msg = "Friendly Reminder: You were late."
        elif level == 2: msg = "Serious Warning: Second late arrival."
        elif level == 3: msg = "Final Warning + HR Meeting: Third late arrival."
        else: msg = "Manager Escalation: 4 or more late arrivals."
        
        warnings.append({
            "dateSent": row['Date'],
            "employeeName": row['Employee Name'],
            "strikeLevel": level,
            "emailPreview": msg,
            "calendarLink": "#" if level >= 3 else None
        })

    # Trend (Last 7 days of data)
    trend_df = df_processed[df_processed['Is Late'] == 'Yes'].groupby('Date')['Employee ID'].count().reset_index()
    trend_df.rename(columns={'Employee ID': 'Count'}, inplace=True)
    trend_df = trend_df.sort_values('Date').tail(7)

    trend = []
    for idx, row in trend_df.iterrows():
        trend.append({
            "date": row['Date'],
            "count": int(row['Count'])
        })

    output = {
        "employees": employees_list,
        "todayRecords": today_records,
        "warnings": warnings,
        "trend": trend
    }

    with open('processed_data.json', 'w') as f:
        json.dump(output, f, indent=2)

    print("Processed data saved to processed_data.json")
    print(f"Total employees: {len(employees_list)}")
    print(f"Employees with strikes: {len([e for e in employees_list if e['lateCount'] > 0])}")

except Exception as e:
    print("Error:", e)
