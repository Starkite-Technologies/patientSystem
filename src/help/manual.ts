// PatientFlow user manual: all help text lives in this one file.
// Write for doctors and nurses in plain language. Keep it true to how the app behaves.
// Formatting: **bold**. Blocks: a string is a paragraph; { list }, { steps } and { note } as below.
// The triage quick reference at the top of the Help page is built from src/model.ts, so colours and
// targets cannot drift from the board.

export type HelpBlock = string | { list: string[] } | { steps: string[] } | { note: string };
export interface HelpSection { id: HelpSectionId; title: string; blocks: HelpBlock[] }
export type HelpSectionId = 'sign-in' | 'board' | 'triage' | 'overdue' | 'register' | 'update' | 'discharge'
  | 'spaces' | 'theatre' | 'theatre-book' | 'theatre-case' | 'display' | 'settings' | 'export' | 'activity' | 'roles' | 'problems';

// Shown quietly on the sign-in page, in the sidebar footer and at the end of Help.
export const developerCredit = 'Developed by Starkite Technologies (Pty) Ltd';
export const supportEmail = 'info@starkite.tech';

export const manualTitle = 'How to use PatientFlow';
export const manualIntro = 'PatientFlow is the shared emergency department board. Everyone signed in sees the same patients, '
  + 'in the same order, with the same next steps. It does not decide triage or treatment: clinical staff do.';
export const pilotNote = 'During the test phase, enter **fictional patients only**. Do not enter real patient details until the hospital confirms the live setup.';

export const manual: HelpSection[] = [
  { id: 'sign-in', title: 'Signing in and signing out', blocks: [
    { steps: [
      'Open the PatientFlow link your coordinator sent you.',
      'Enter your work email address and the password you were given, then press **Sign in**.',
    ] },
    'There is no "create account" button. Your administrator sets up every account. If you forgot your password, ask them to reset it.',
    'To sign out, press the **sign-out arrow** next to your name at the bottom of the sidebar. On a phone, your name and the sign-out arrow are at the top of the menu.',
    { note: 'Always sign out on a shared computer or tablet. Closing the browser tab does not sign you out.' },
  ] },
  { id: 'board', title: 'Reading the board', blocks: [
    'The **Patient board** lists every patient still in the department. The most urgent are at the top: Red first, then Orange, Yellow, Green and Blue. Within the same colour, the patient who arrived first is higher.',
    'Each patient shows:',
    { list: [
      '**Patient**: name, reference number (for example PF-000012), age and presenting complaint.',
      '**Triage**: colour, label and target time.',
      '**Status**: Waiting, Ready, In treatment, Awaiting results or Observation.',
      '**Location**: the assigned space, or where the patient is (for example Waiting area).',
      '**Next step / queue**: the next service, and the patient\'s place in that queue (#2 means second in line).',
      '**Clinician**: the responsible clinician, or Unassigned.',
      '**Time in ED**: time since arrival.',
    ] },
    'The boxes at the top count active patients, Red and Orange patients, patients waiting or ready, and free spaces.',
    'Use the **search box** to find a name, reference, complaint, clinician or location. Use the drop-down lists to show only one triage colour, status or next service.',
    'The board updates by itself every 30 seconds. The time of the last update is at the bottom of the list. Press the **circular arrows** next to the update status to refresh now.',
    'On a phone or a narrow tablet, each patient appears as a card instead of a table row. The information is the same.',
  ] },
  { id: 'triage', title: 'The five triage colours', blocks: [
    'PatientFlow uses the Manchester Triage System colours. The quick reference at the top of this page shows each colour, its label and its target time.',
    'Every patient shows the **colour name and label in words** as well as the colour, so the board can be read without relying on colour.',
    'The triage category is chosen by clinical staff when registering or updating a patient. PatientFlow does not calculate triage.',
  ] },
  { id: 'overdue', title: 'Overdue flags', blocks: [
    'A patient is **overdue** when they are still **Waiting** or **Ready** (not yet being seen) and their time in ED is longer than the target for their colour.',
    'An overdue patient shows a red **Overdue +25m** label under the triage badge (the time past the target) and a red bar on the left of the row or card.',
    'Red means "seen at once", so a Red patient who is still Waiting or Ready is flagged after the first minute.',
    'The flag disappears when the status changes to In treatment, Awaiting results or Observation, or when the patient is discharged or transferred.',
  ] },
  { id: 'register', title: 'Registering a patient', blocks: [
    'Nurses, surgeons, clinicians and coordinators can register patients.',
    { steps: [
      'Press **Register patient** at the top right of the board.',
      'Under **Register for**, choose **New patient**, or choose an existing patient for a repeat visit.',
      'Enter first name and last name. Date of birth is optional: leave it blank if unknown.',
      'Enter the presenting complaint and choose the **triage colour**.',
      'Set the care status, next service and responsible clinician if known.',
      'Choose an **assigned space** if the patient goes straight to one. Only available spaces can be chosen. If there is no space, type where the patient is in **Location**.',
      'Add handover notes if useful, then press **Register patient**.',
    ] },
    'The reference number (PF-…) is created automatically. A patient cannot have two active visits at the same time.',
  ] },
  { id: 'update', title: 'Updating status, location and clinician', blocks: [
    { steps: [
      'Press the **arrow (›)** at the end of the patient\'s row. On a card, it is at the top right.',
      'Change what is needed: triage colour, care status, next service, responsible clinician, assigned space or location.',
      'Press **Save changes**.',
    ] },
    'Choosing a space fills in the location automatically. To move a patient, choose the new space. The old space is released.',
    'If someone else saved the same patient a moment before you, you will see "This patient was updated elsewhere". Close the record, open it again and make your change once more.',
    'Changing a name or date of birth changes it for all of that patient\'s visits.',
    'Viewers can open patient details but cannot change them.',
  ] },
  { id: 'discharge', title: 'Discharge and transfer', blocks: [
    { steps: [
      'Open the patient and set **Care status** to **Discharged** or **Transferred**.',
      'Press **Save changes**.',
    ] },
    'The patient leaves the board and their space is released. They now appear under **Completed visits**, where time in ED counts up to the last update.',
    'After a discharge or transfer, a nurse or coordinator should mark the space **Cleaning**, then **Available** when it is ready.',
    { note: 'There is no undo button. Check the patient before saving. If someone was discharged by mistake, tell the coordinator.' },
  ] },
  { id: 'spaces', title: 'Spaces and cleaning status', blocks: [
    'The **Spaces & resources** page shows every treatment space and whether it is Occupied (with the patient\'s name), Available, Cleaning or Unavailable.',
    '**Nurses and coordinators** can change a space to Available, Cleaning or Unavailable with the drop-down on its card. Surgeons, clinicians and viewers can see spaces but not change them.',
    'An occupied space cannot be changed. Move, discharge or transfer the patient first.',
    'Only Available spaces can be assigned to a patient.',
  ] },
  { id: 'theatre', title: 'The emergency theatre list', blocks: [
    'The **Theatre list** shows every patient waiting for emergency surgery or in theatre, across all specialties, in one list.',
    'Each case has two separate things:',
    { list: [
      '**Priority code** (P0 to P6) with its NCEPOD category: Immediate, Urgent or Expedited. A clinician chooses it. PatientFlow **never changes it by itself**.',
      '**Deadline status**: On target, Approaching, Deadline imminent, Past deadline, or Immediate for P0. It is worked out from the time since the **decision to operate**, not from booking or arrival.',
    ] },
    'The list puts the most urgent code first, then the nearest deadline. A less urgent case never moves above a more urgent one because its deadline is closer.',
    'The **Operating theatres** panel shows which theatre is in use, when it is expected to be free and the next planned case. The **Priority codes** panel shows each code and its target.',
    { note: 'Codes, targets and deadline colours are placeholders until the surgical, anaesthetic and theatre leads approve them. The list only alerts people who have it open: for P0 cases, always use the hospital\'s emergency call process as well.' },
  ] },
  { id: 'theatre-book', title: 'Booking a theatre case', blocks: [
    'Clinicians, surgeons and anaesthetists can book cases.',
    '**Rapid P0** (life-threatening, under 30 seconds): press **Rapid P0**, choose or enter the patient, type the operation and the location, then press **Book immediate case**. The case shows **Details incomplete** until the rest is filled in.',
    '**Standard booking** (2 to 3 minutes): press **Book case** and complete:',
    { steps: [
      'Patient: choose a patient already in the department, or enter a new one. Add the hospital MRN if known.',
      'Operation: specialty, responsible consultant, diagnosis, proposed operation, indication and estimated duration.',
      'Decision to operate: when the team decided surgery is needed. The deadline counts from this time, so enter it even if booking later.',
      'Urgency: the priority code and the likely consequence if surgery is delayed beyond the target.',
      'Patient condition: unstable, septic shock, organ support, major anaesthetic concern. Answer each one; unknown is never treated as normal.',
    ] },
    'If the condition does not match the code (for example septic shock booked as P5), PatientFlow shows a warning. It does not change the code.',
  ] },
  { id: 'theatre-case', title: 'Updating a theatre case', blocks: [
    'Press the **arrow (›)** on a case to open it.',
    { list: [
      '**Theatre times**: press **Anaesthesia started now**, **Surgery started now** and **Completed now**. These are never blocked, even after the deadline. A theatre must be assigned first.',
      '**Theatre and readiness**: the theatre coordinator, surgeon or anaesthetist assigns the theatre and planned start. Anyone on the theatre team except viewers can mark the patient ready.',
      '**Reason for delay**: once a case is past its deadline, the reason must be recorded before other changes can be saved.',
      '**Priority**: only a consultant surgeon or anaesthetist can change it, and must give the clinical reason. Every change is kept with who, when and why.',
      '**Cancel**: the consultant surgeon, or the coordinator with the authorising consultant named. Only before anaesthesia starts.',
    ] },
    'Completed and cancelled cases stay visible for 24 hours at the bottom of the list, and every change is in the **Activity log**.',
  ] },
  { id: 'display', title: 'Display mode and text size', blocks: [
    '**Display mode** is for a screen that staff glance at from a distance. Press **Display mode** at the top right of the board. Names, complaints and editing are hidden. Reference, age, triage, status, location and time in ED stay visible. Press **Exit display** to go back.',
    { note: 'Display mode still needs a signed-in account and still shows patient references. Put the screen where only staff can see it, not in a public waiting room.' },
    'Display mode also works on the theatre list: booking references replace names.',
    '**Text size**: use the **A A A** switch in the sidebar, or **Settings**, to choose Normal, Large or Extra large. Everything on the screen grows, including the board and this help. The choice is remembered on that device and browser only.',
  ] },
  { id: 'settings', title: 'Settings', blocks: [
    'Open **Settings** in the sidebar or at the bottom of any page.',
    { list: [
      '**Display**: text size, and which screen opens first after sign-in (Patient board or Theatre list). Saved on this device only.',
      '**Your account**: who is signed in, your role, what your role can do, and **Sign out**.',
      '**Theatre priority codes**: the codes, targets and deadline colour thresholds in use, and whether they are clinically approved. Read-only.',
      '**About and support**: who developed PatientFlow and the support email address.',
    ] },
  ] },
  { id: 'export', title: 'Exporting', blocks: [
    'Coordinators can download the board or completed visits as a spreadsheet file (CSV) that opens in Excel. Coordinators, surgeons and anaesthetists can also export the **Theatre list**: with no dates, the open list; with dates, every case decided in those dates.',
    { steps: [
      'Go to **Patient board** or **Completed visits**.',
      'Set the search and filters you want. The export uses the same filters.',
      'Press **Export**. Choose arrival dates if needed. Leave them blank for all dates.',
      'Press **Download CSV**. The file is named with today\'s date, for example patientflow-visits-2026-10-26.csv.',
    ] },
    'The file contains reference, names, date of birth, age, triage, target, status, location, next service, clinician, complaint, arrival time, time in ED, minutes overdue and last update. It does not contain handover notes or internal system numbers.',
    'Every export is recorded in the **Activity log** with your name, the time and the patient references included.',
    { note: 'The file contains patient information. Store it only where hospital policy allows. Do not email it or leave it in the Downloads folder.' },
  ] },
  { id: 'activity', title: 'Activity log', blocks: [
    'The **Activity log** lists the most recent changes: patients registered and updated, theatre bookings, priority changes, theatre times, delays, cancellations, spaces changed and exports. Each entry shows who made the change and when.',
    'Entries cannot be edited or deleted from PatientFlow.',
  ] },
  { id: 'roles', title: 'Who can do what', blocks: [
    { list: [
      '**Viewer**: sees the board, spaces and activity. Cannot change anything.',
      '**Clinician** (medical officer / registrar): register and update ED patients; book theatre cases and update their clinical details.',
      '**Surgeon** (consultant): as clinician, and can change theatre priority, assign theatres, cancel cases and export the theatre list.',
      '**Anaesthetist**: books and updates theatre cases, changes priority with a reason, assigns theatres, exports the theatre list. Sees the ED board.',
      '**Nurse**: registers and updates ED patients, changes space status, marks theatre readiness and records theatre times.',
      '**Coordinator**: changes space status, assigns theatres, records delays and times, cancels with consultant authorisation, and exports.',
    ] },
    'Your role is shown under your name in the sidebar. Ask the administrator if you need a different role.',
  ] },
  { id: 'problems', title: 'If the page does not open or stops updating', blocks: [
    '**The page does not open.** The address is https://patientflow.starkitetechnologies.com. During the pilot it runs on one computer: if that computer is off, asleep or offline, the page shows an error. Tell the coordinator.',
    '**"Updates delayed" appears in orange.** The board could not load the latest information. Press the circular arrows to try again and check the device\'s internet connection.',
    '**You are asked to sign in again.** Your session expired. Sign in again; nothing you saved is lost.',
    '**A save fails.** Read the message. Check the board before trying again, so the same change is not entered twice.',
    { note: 'If the board is still not working after a few minutes, switch to the paper backup process and tell the coordinator.' },
  ] },
];
