"""Fictional typed E-1 fixtures. Expected values stay outside application code."""
from pathlib import Path
import sys,json
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/python'))
import fitz
spec=json.loads((ROOT/'packages/core/src/sss-e1.json').read_text())
out=ROOT/'fixtures/sss';out.mkdir(exist_ok=True)
pdfout=ROOT/'output/pdf';pdfout.mkdir(parents=True,exist_ok=True)
def base():
    return dict(sss_ss_number='0012345678',sss_registrant_last_name='ALVAREZ',sss_registrant_first_name='MIRA',sss_registrant_middle_name='LOPEZ',
      sss_birth_date='04151994',sss_sex='Female',sss_civil_status='Married',sss_tin='001234567',sss_nationality='FILIPINO',sss_religion='CATHOLIC',
      sss_place_of_birth='PASIG CITY',sss_address_unit_building='UNIT 2 TEST BUILDING',sss_address_house_lot='12 BLOCK 3',sss_address_street='SAMPLE STREET',
      sss_address_subdivision='TEST VILLAGE',sss_address_barangay='SAN MIGUEL',sss_address_city='PASIG',sss_address_province='METRO MANILA',
      sss_address_country='PHILIPPINES',sss_address_zip='1600',sss_mobile='09123456789',sss_email='mira@example.test',sss_telephone='02 8123 4567',
      sss_father_last_name='ALVAREZ',sss_father_first_name='DARIO',sss_father_middle_name='REYES',sss_mother_last_name='LOPEZ',sss_mother_first_name='CORAZON',sss_mother_middle_name='GARCIA',
      sss_spouse_last_name='TORRES',sss_spouse_first_name='LUIS',sss_spouse_middle_name='CRUZ',sss_spouse_birth_date='03201992',
      sss_additional_sheet_used='No',sss_employment_section='Not applicable',sss_certification_printed_name='MIRA LOPEZ ALVAREZ',sss_certification_date='11182026',sss_certification_review='Reviewed on image')
def add_children(v,prefix,count):
    for i,name in enumerate(['LARA','NINA','PAOLO','RAMON','TERESA'][:count],1):
        v.update({f'sss_{prefix}_{i}_last_name':'ALVAREZ',f'sss_{prefix}_{i}_first_name':name,f'sss_{prefix}_{i}_middle_name':'TORRES',f'sss_{prefix}_{i}_birth_date':f'0615{2014+i}'})
def additional(v):
    v.update(sss_additional_sheet_used='Yes',sss_additional_ss_number='0012345678',sss_additional_registrant_last_name='ALVAREZ',
      sss_additional_registrant_first_name='MIRA',sss_additional_registrant_middle_name='LOPEZ',sss_additional_printed_name='MIRA LOPEZ ALVAREZ',sss_additional_date='11182026',sss_additional_certification_review='Reviewed on image')
cases={}
clean=base();add_children(clean,'child',1);cases['clean']=clean
extra=base();additional(extra);add_children(extra,'child',5);add_children(extra,'additional_child',5)
extra.update(sss_employment_section='OFW',sss_ofw_address_line_1='42 TEST ROAD',sss_ofw_address_line_2='DOHA QATAR',sss_ofw_earnings='35000.00',sss_ofw_flexi_fund='No');cases['additional']=extra
benefit=base();additional(benefit)
for key in list(benefit):
    if key.startswith(('sss_spouse_','sss_father_','sss_mother_')):benefit.pop(key)
benefit.update(sss_civil_status='Single',sss_employment_section='Self-employed',sss_se_profession='CONSULTANT',sss_se_started='2020',sss_se_earnings='18000.00')
for prefix in ['beneficiary','additional_beneficiary']:
    for i,name in enumerate(['CELIA','DANTE'],1):
        benefit.update({f'sss_{prefix}_{i}_last_name':'SANTOS',f'sss_{prefix}_{i}_first_name':name,f'sss_{prefix}_{i}_middle_name':'RAMOS',f'sss_{prefix}_{i}_relationship':'SISTER' if i==1 else 'BROTHER',f'sss_{prefix}_{i}_birth_date':f'0822{1980+i}'})
cases['beneficiaries']=benefit
nws=base();nws.update(sss_employment_section='Non-working spouse',sss_working_spouse_number='000123456789',sss_working_spouse_income='25000.00',sss_working_spouse_printed_name='LUIS CRUZ TORRES',sss_working_spouse_consent_review='Reviewed on image');cases['nws']=nws
invalid=base();invalid.update(sss_registrant_first_name='',sss_birth_date='02301994',sss_ss_number='123',sss_email='bad@@example',sss_certification_review='Needs correction');cases['invalid']=invalid

for name,values in cases.items():
    raw={f['id']:values.get(f['id'],'') for f in spec['fields']}
    normalized={key:(f'{value[4:]}-{value[:2]}-{value[2:4]}' if next(f for f in spec['fields'] if f['id']==key)['type']=='date' and len(value)==8 and value.isdigit() else value) for key,value in raw.items()}
    doc=fitz.open(ROOT/'references/sss-e1-cov01214-09-2015.pdf')
    pages=[1,3] if values['sss_additional_sheet_used']=='Yes' else [1]
    for number in pages:
        page=doc[number-1]
        for f in spec['fields']:
            value=raw[f['id']]
            if f['page']!=number or not f.get('points') or not value:continue
            x,y,w,h=f['points'];font=min(8.5,h*.74)
            if f.get('grid'):
                # One typed character per printed cell; no recognition result informs the fixture.
                cells=f['cells'];step=w/cells
                for index,char in enumerate(value):
                    if index>=cells:break
                    tw=fitz.get_text_length(char,fontname='helv',fontsize=font)
                    page.insert_text((x+index*step+(step-tw)/2,y+h-1.3),char,fontsize=font,fontname='helv')
            else:
                font=min(font,w/max(1,fitz.get_text_length(value,fontname='helv',fontsize=1))*.96)
                page.insert_text((x+1,y+h-1.4),value,fontsize=font,fontname='helv')
        page.insert_text((22,783),'FICTIONAL TEST ONLY - '+name.upper(),fontsize=7,color=(.65,0,0))
        page.get_pixmap(matrix=fitz.Matrix(1600/612,1600/612),alpha=False).save(out/f'sss-{name}-page-{number}.png')
    target=fitz.open()
    for number in pages:target.insert_pdf(doc,from_page=number-1,to_page=number-1)
    target.save(pdfout/f'SSS-E1-{name}-fictional.pdf')
    (out/f'sss-{name}.json').write_text(json.dumps(dict(case=name,pages=pages,raw=raw,values=normalized,notes='Fictional typed fixture; manual checkbox/review answers are supplied by a human test operator, never OCR.'),indent=2)+'\n')
(out/'sss-mapping.json').write_text(json.dumps(dict(templateId=spec['id'],templateVersion=spec['version'],fields=spec['fields']),indent=2)+'\n')
print('Created five fictional cases, including all dependent rows, optional blanks and invalid identities/dates. Source PDF unchanged.')
