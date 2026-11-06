"""Synthetic Namibian population for the mock national registry (Master Patient Index).

Every person here is fictional and generated from a fixed seed, so the data is
reproducible. Names, regions and hospital names are used only to make the demo
look realistic; no record describes a real person.

Health IDs are sequential so a presenter can type them:
  NHI-1000001 … NHI-1000035  exist in the registry (70%)
  NHI-1000036 … NHI-1000050  are "new" patients, not in the registry (30%)
"""
from __future__ import annotations

import random
from datetime import date, timedelta

SEED = 2026
REGISTRY_COUNT = 35
TOTAL = 50

FEMALE = ['Ndapewa', 'Ndeshipanda', 'Selma', 'Hilma', 'Ester', 'Uerikua', 'Kaarina', 'Fransina', 'Albertina', 'Nangula',
          'Magano', 'Johanna', 'Rauha', 'Saara', 'Ruusa', 'Tuyeni', 'Elize', 'Kauna', 'Vistorina', 'Martha']
MALE = ['Paulus', 'Johannes', 'Festus', 'Gideon', 'Erastus', 'Hafeni', 'Penda', 'Uapingene', 'Jakobus', 'Hendrik',
        'Willem', 'Josua', 'Matheus', 'Lazarus', 'Tuhafeni', 'Simasiku', 'Kandjii', 'Moses', 'Elago', 'Petrus']
FAMILY = ['Shilongo', 'Nghipondoka', 'Amutenya', 'Haufiku', 'Iipumbu', 'Kambonde', 'Tjituka', 'Kavari', 'Hoebeb', 'Gaseb',
          'Garoeb', 'Nakale', 'Shikongo', 'Mwilima', 'Sibalatani', 'Kapia', 'Mbahuurua', 'Nambahu', 'van Wyk', 'Beukes',
          'Kandjeke', 'Nekongo', 'Shipanga', 'Muremi', 'Likando', 'Haingura', 'Tjiroze', 'Swartbooi', 'Ndjavera', 'Namene']
REGIONS = {
    'Khomas': 'Windhoek Central Hospital', 'Erongo': 'Walvis Bay State Hospital', 'Oshana': 'Oshakati Intermediate Hospital',
    'Oshikoto': 'Onandjokwe Intermediate Hospital', 'Ohangwena': 'Engela District Hospital', 'Omusati': 'Outapi District Hospital',
    'Kavango East': 'Rundu Intermediate Hospital', 'Kavango West': 'Nankudu District Hospital', 'Zambezi': 'Katima Mulilo State Hospital',
    'Kunene': 'Opuwo District Hospital', 'Otjozondjupa': 'Otjiwarongo State Hospital', 'Omaheke': 'Gobabis State Hospital',
    'Hardap': 'Mariental State Hospital', '//Karas': 'Keetmanshoop State Hospital',
}
# Weighted roughly towards the more populous regions.
REGION_WEIGHTS = [22, 8, 9, 7, 8, 7, 7, 3, 4, 3, 6, 3, 4, 4]
CHRONIC = ['Essential hypertension', 'Type 2 diabetes mellitus', 'Asthma', 'Pulmonary tuberculosis, completed treatment',
           'Epilepsy', 'Chronic kidney disease, stage 3', 'Chronic obstructive pulmonary disease', 'Heart failure',
           'Hypercholesterolaemia', 'Osteoarthritis of knee']
ALLERGIES = ['Penicillin', 'Sulfonamides', 'NSAIDs (ibuprofen)', 'Latex', 'Codeine']
VISIT_REASONS = ['Uncontrolled blood pressure', 'Asthma exacerbation', 'Hypoglycaemia', 'Malaria, uncomplicated',
                 'Laceration to hand', 'Lower respiratory tract infection', 'Urinary tract infection', 'Gastroenteritis',
                 'Fall with wrist sprain', 'Routine chronic care review', 'Chest pain, non-cardiac', 'Seizure, single episode']
REASON_FOR = {'Essential hypertension': 'Uncontrolled blood pressure', 'Asthma': 'Asthma exacerbation',
              'Type 2 diabetes mellitus': 'Hypoglycaemia', 'Epilepsy': 'Seizure, single episode'}


def _people():
    rng = random.Random(SEED)
    people = []
    regions = list(REGIONS)
    for i in range(TOTAL):
        gender = 'female' if rng.random() < 0.52 else 'male'
        given = rng.choice(FEMALE if gender == 'female' else MALE)
        family = rng.choice(FAMILY)
        age = rng.choice([rng.randint(1, 15), rng.randint(16, 45), rng.randint(16, 45), rng.randint(46, 70), rng.randint(71, 89)])
        birth = date(2026, 6, 30) - timedelta(days=age * 365 + rng.randint(0, 364))
        region = rng.choices(regions, weights=REGION_WEIGHTS)[0]
        seq = i + 1
        person = {
            'health_id': f'NHI-{1000000 + seq}',
            'national_id': birth.strftime('%y%m%d') + f'{rng.randint(100, 999)}{seq:02d}',
            'given': given, 'family': family, 'gender': gender, 'birth_date': birth.isoformat(), 'region': region,
            'phone': f'+264 81 {rng.randint(100, 999)} {rng.randint(1000, 9999)}',
            'in_registry': seq <= REGISTRY_COUNT,
            'conditions': [], 'allergies': [], 'encounters': [],
        }
        if person['in_registry']:
            chronic_count = 0 if age < 16 else rng.choices([0, 1, 2], weights=[3, 4, 2])[0]
            person['conditions'] = rng.sample(CHRONIC if age >= 16 else ['Asthma'], k=min(chronic_count, len(CHRONIC)))
            if age < 16 and rng.random() < 0.3:
                person['conditions'] = ['Asthma']
            person['allergies'] = rng.sample(ALLERGIES, k=rng.choices([0, 1], weights=[4, 1])[0])
            for _ in range(rng.randint(1, 4)):
                visit = date(2026, 10, 15) - timedelta(days=rng.randint(30, 1500))
                reason = REASON_FOR.get(rng.choice(person['conditions'])) if person['conditions'] and rng.random() < 0.5 else rng.choice(VISIT_REASONS)
                facility = REGIONS[region] if rng.random() < 0.75 else rng.choice(list(REGIONS.values()))
                person['encounters'].append({'date': visit.isoformat(), 'facility': facility, 'reason': reason or rng.choice(VISIT_REASONS)})
            person['encounters'].sort(key=lambda e: e['date'], reverse=True)
        people.append(person)
    # The first record is the scripted demo patient: give her a clear, useful history.
    people[0].update({
        'given': 'Ndapewa', 'family': 'Shilongo', 'gender': 'female', 'birth_date': '1968-03-14', 'region': 'Khomas',
        'national_id': '68031420001',
        'conditions': ['Essential hypertension', 'Type 2 diabetes mellitus'], 'allergies': ['Penicillin'],
        'encounters': [
            {'date': '2026-08-02', 'facility': 'Windhoek Central Hospital', 'reason': 'Uncontrolled blood pressure'},
            {'date': '2025-11-19', 'facility': 'Windhoek Central Hospital', 'reason': 'Hypoglycaemia'},
            {'date': '2024-05-07', 'facility': 'Oshakati Intermediate Hospital', 'reason': 'Urinary tract infection'},
        ],
    })
    return people


PEOPLE = _people()
