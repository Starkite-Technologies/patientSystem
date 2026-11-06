# PatientFlow user manual (CRAN demo)

PatientFlow is an AI-assisted emergency department (ED) triage and patient-flow system by Starkite Technologies.
This manual covers the CRAN Tech Challenge demo. All patients in the demo are fictional (synthetic data).
The national registry in the demo is a mock. It is not connected to the Ministry of Health and Social Services.

## Roles and the role switcher

Use the role buttons at the top right: **Nurse**, **Doctor** or **Supervisor**.
- Nurse: registers arrivals, records vitals, confirms triage levels and handles deterioration alerts.
- Doctor: everything a nurse can do, plus dictating and signing notes and the shift handover.
- Supervisor: views the dashboard and forecast, and downloads exports.
Every decision is logged with the name of the demo user and the time.

## Register an arriving patient

1. Choose **Arrival** in the top menu.
2. Type the patient's health ID (for example NHI-1000001) or national ID and press **Search registry**.
3. If the patient is found, the registry record and an AI summary of their history appear. Check the name and date of birth with the patient.
4. If the patient is not found, the form opens for a new patient. Fill in first name, last name, sex and date of birth, then press **Register patient**.
5. Continue with vitals and the chief complaint (next section).

## Record vitals and the chief complaint

On the arrival screen, enter heart rate, respiratory rate, blood pressure (systolic and diastolic), temperature, oxygen saturation (SpO2), consciousness level (ACVPU) and tick **On oxygen** if the patient receives supplemental oxygen. Type the chief complaint in plain words. Press **Get triage suggestion**.

## Triage suggestion and confirming a level

After **Get triage suggestion**, PatientFlow shows:
- the **rule-based baseline** (NEWS2 score from the vitals), which is always calculated;
- the **AI suggestion** with 2–3 reasons, labelled "Suggested by AI", when the AI is available.
If the two disagree, both are shown and the more urgent one is highlighted.
Press **Confirm** to accept the highlighted level, or **Change** to choose another level. When you change a level, give a short reason. The AI never sets the level; only your confirmation does. The patient then appears on the board.

## Triage levels

PatientFlow uses five Manchester Triage System categories. The colour is always shown with its name and an icon:
- P1 Red – Immediate (seen at once)
- P2 Orange – Very urgent (within 10 minutes)
- P3 Yellow – Urgent (within 60 minutes)
- P4 Green – Standard (within 120 minutes)
- P5 Blue – Non-urgent (within 240 minutes)
A waiting time shown in red with "Over target" means the patient has waited longer than the target for their level.

## The live board

Choose **Board**. The board shows every active patient and updates by itself every few seconds. Patients waiting for triage are shown first, then patients by level (most urgent first) and waiting time (longest first within a level). Each card shows the level, the waiting-time timer, the complaint, the latest NEWS2 score and the status. Click a card to open the patient view.

## Deterioration alerts

When new vitals are worse than the previous set, PatientFlow raises an alert on the board: "Suggest moving up to <level>", with the reasons.
- Press **Confirm** to move the patient up to the suggested level.
- Press **Dismiss** if you have reviewed the patient and the current level is right.
Both choices are logged. The alert never changes the level by itself.

## Record new vitals for a waiting patient

Open the patient from the board, go to **Vitals**, enter the new values and press **Save vitals**. If the patient has deteriorated, an alert appears on the board and in the patient view.

## Patient view

The patient view shows the registry summary and history (past visits, conditions, allergies), vitals over time with the NEWS2 trend, notes and the triage history (every suggestion and decision with user and time). From here you can **Start treatment**, record vitals, write a note, and **Discharge** or **Admit**.

## Dictate and sign a note (doctor)

1. Switch to **Doctor** and open the patient.
2. In **Notes**, press **Start dictation** and speak. Press **Stop** when done. You can also type or correct the transcript.
3. Press **Draft note**. The AI drafts a structured note: presenting complaint, findings and plan. It is labelled "Suggested by AI" (or "Rule-based draft" without AI).
4. Edit the draft as needed, then press **Sign note**. Only signed notes are saved to the record.
Dictation uses the browser's speech recognition and works best in Chrome or Edge. Names and IDs are removed before the transcript is sent to the AI.

## Shift handover summary

On the board, press **Shift handover**. PatientFlow writes a one-line summary per active patient, most urgent first, and an overall line on department load. Read it aloud or copy it with **Copy**. It is a draft for the clinician to check.

## Discharge or admit

Open the patient and press **Discharge** or **Admit**. This closes the visit and removes the patient from the board. The decision is logged.

## Supervisor dashboard and forecast

Switch to **Supervisor** and choose **Dashboard**. You see patients by level, average waiting time by level, arrivals today, open alerts, and the crowding forecast for the next 6 hours. The forecast is the average number of arrivals in the same weekday and hour over the last 8 weeks; the bar range shows the lowest and highest of those weeks. It is a forecast, not a guarantee.

## Exports

On the dashboard, under **Exports**:
- **FHIR Bundle (today)**: every ED visit today as an HL7 FHIR R4 Bundle (JSON). From a patient view, **FHIR Bundle (this visit)** exports one encounter.
- **DHIS2-style report**: ED visits by triage level for the day as a DHIS2-compatible dataValueSet (demo format, placeholder codes).
- **CSV**: one row per ED visit for the day, for spreadsheets.

## AI status and working without AI

The banner under the header says whether the AI assistant is on. If there is no AI key, or the AI does not respond, PatientFlow uses its rule-based engine and says so. Triage baseline, deterioration alerts, summaries, note drafts, handover and help all keep working. The AI only receives age, sex, vitals, complaint and de-identified history, never names or IDs.

## Demo mode and reset

The demo starts with 12 patients waiting and one patient whose vitals worsen about 60 seconds later, so the deterioration alert fires live. Press **Reset demo** (top right) to restore this starting state. Press **Trigger deterioration** to make the scripted patient deteriorate immediately. **Demo IDs** lists the synthetic health IDs: NHI-1000001 to NHI-1000035 are in the mock registry; NHI-1000036 to NHI-1000050 are new patients.

## Getting help

Press **Help** (the question-mark button) and type a question such as "How do I confirm a triage level?". The helper answers from this manual. Without AI it shows the closest manual section.
