"""Render and map the supplied fixed SSS E-1 (09-2015); never modify the source PDF."""
from pathlib import Path
import sys, json, hashlib
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/python'))
import fitz

source = ROOT / 'references/sss-e1-cov01214-09-2015.pdf'
fields = []
def field(key, label, section, page, box=None, kind='text', **kwargs):
    value = dict(id='sss_' + key, label=label, section=section, page=page, type=kind, required=False,
                 mode='ocr' if box else 'manual')
    value.update(kwargs)
    if box:
        x,y,w,h=box
        value['region'] = dict(x=x/612,y=y/792,width=w/612,height=h/792)
        value['points'] = box
    fields.append(value)

def names(prefix, label, section, page, y, columns, row=None, required=False, height=11):
    for index, part in enumerate(['last_name','first_name','middle_name','suffix']):
        x,w=columns[index]
        field(prefix+'_'+part, label+' - '+part.replace('_',' '),section,page,(x,y,w,height),
              'name' if part!='suffix' else 'text',row=row,required=required and index<2)

main='A. Registrant'; contact='A. Address and contact'; parents='A. Parents'
field('ss_number','SS number (if already assigned)',main,1,(432,36,160,21),'identifier',digits=[10])
names('registrant','Registrant',main,1,132,[(18,158),(180,123),(307,122),(432,39)],required=True)
field('birth_date','Registrant date of birth (MMDDYYYY)',main,1,(474.5,134,122.4,10),'date',required=True,cells=8,grid=True)
field('sex','Sex - check the original box',main,1,kind='choice',required=True,options=['Male','Female'])
field('civil_status','Civil status - check the original box',main,1,kind='choice',required=True,options=['Single','Married','Widowed','Legally Separated','Others'])
field('civil_status_other','Other civil status (as written)',main,1,(386,160,72,9),when={'field':'sss_civil_status','values':['Others']})
field('tin','Tax identification number (if any)',main,1,(459.3,158,137.6,11),'identifier',digits=[9],cells=9,grid=True)
field('nationality','Nationality',main,1,(18,181,86,11),required=True)
field('religion','Religion',main,1,(110,181,148,11))
field('place_of_birth','Place of birth (city/municipality, province; country if abroad)',main,1,(264,181,330,11),required=True)
for key,label,x,w in [('unit_building','Room/floor/unit and building',18,235),('house_lot','House/lot and block',256,108),('street','Street',368,110),('subdivision','Subdivision',482,112)]:
    field('address_'+key,label,contact,1,(x,204,w,9))
for key,label,x,w in [('barangay','Barangay/district/locality',18,141),('city','City/municipality',163,146),('province','Province',313,113),('country','Country',430,101),('zip','ZIP code',537,57)]:
    field('address_'+key,label,contact,1,(x,225,w,9),'identifier' if key=='zip' else 'text',**({'digits':[4]} if key=='zip' else {}))
field('mobile','Mobile/cellphone number',contact,1,(18,245,164,9),'phone')
field('email','Email address',contact,1,(188,245,208,9),'email')
field('telephone','Telephone (country + area code + number)',contact,1,(402,245,192,9),'phone')
parentColumns=[(103,146),(253,116),(373,115),(492,102)]
names('father','Father',parents,1,265,parentColumns)
names('mother','Mother (maiden name)',parents,1,286,parentColumns)
names('spouse','Spouse','B. Spouse',1,318,[(48,149),(201,104),(309,91),(405,67)],row='spouse')
field('spouse_birth_date','Spouse date of birth','B. Spouse',1,(474.5,320,122.4,10),'date',row='spouse',cells=8,grid=True)
field('additional_sheet_used','Additional sheet checkbox - check the original', 'B. Additional sheet',1,kind='choice',required=True,options=['Yes','No'])

def children(page,ends,prefix,section):
    for row,end in enumerate(ends,1):
        key=f'{prefix}_{row}'
        names(key,f'Child {row}',section,page,end-12.5,[(31,166),(201,104),(309,91),(405,67)],row=key)
        field(key+'_birth_date',f'Child {row} - date of birth',section,page,(474.5 if page==1 else 473.3,end-10.8,122.4 if page==1 else 123.6,10),'date',row=key,cells=8,grid=True)
def beneficiaries(page,ends,prefix,section):
    for row,end in enumerate(ends,1):
        key=f'{prefix}_{row}'
        names(key,f'Beneficiary {row}',section,page,end-12,[(31,82),(117,73),(194,89),(287,63)],row=key)
        field(key+'_relationship',f'Beneficiary {row} - relationship',section,page,(354,end-12,117,11),row=key)
        field(key+'_birth_date',f'Beneficiary {row} - date of birth',section,page,(474.5 if page==1 else 473.3,end-10.8,122.4 if page==1 else 123.6,10),'date',row=key,cells=8,grid=True)
children(1,[355.08,372.72,390.24,407.88,425.52],'child','B. Children (five rows)')
beneficiaries(1,[456.72,473.88],'beneficiary','B. Other beneficiaries (when applicable)')
employment='C. Employment (when applicable)'
field('employment_section','Section C to review (choose applicability; not OCR)',employment,1,kind='choice',required=True,
      options=['Not applicable','Self-employed','OFW','Non-working spouse'])
def condition(value):return {'field':'sss_employment_section','values':[value]}
field('se_profession','Self-employed - profession/business',employment,1,(32,509,116,9),when=condition('Self-employed'))
field('se_started','Self-employed - year business started',employment,1,(32,533,116,9),'year',when=condition('Self-employed'))
field('se_earnings','Self-employed - monthly earnings (PHP)',employment,1,(40,556,108,11),'amount',when=condition('Self-employed'))
field('ofw_address_line_1','OFW - foreign address line 1',employment,1,(230,498,166,9),when=condition('OFW'))
field('ofw_address_line_2','OFW - foreign address line 2',employment,1,(172,509,224,9),when=condition('OFW'))
field('ofw_earnings','OFW - monthly earnings (PHP)',employment,1,(180,556,90,11),'amount',when=condition('OFW'))
field('ofw_flexi_fund','OFW - Flexi-Fund checkbox',employment,1,kind='choice',options=['Yes','No'],when=condition('OFW'))
field('working_spouse_number','Working spouse SS number / CRN',employment,1,(419,508,175,10),'identifier',digits=[10,12],cells=12,grid=True,when=condition('Non-working spouse'))
field('working_spouse_income','Working spouse monthly income (PHP)',employment,1,(535,522,59,9),'amount',when=condition('Non-working spouse'))
field('working_spouse_printed_name','Working spouse printed name (manual; signature shares this area)',employment,1,kind='name',when=condition('Non-working spouse'))
field('working_spouse_consent_review','Working spouse consent/signature - visual review',employment,1,kind='choice',options=['Reviewed on image','Needs correction','Not applicable'],when=condition('Non-working spouse'))
field('certification_printed_name','Registrant printed name', 'D. Certification',1,(32,638,137,13),'name')
field('certification_date','Certification date (MMDDYYYY)', 'D. Certification',1,(314,638,69,13),'date')
field('certification_review','Certification/signature/fingerprint areas - visual review', 'D. Certification',1,kind='choice',required=True,options=['Reviewed on image','Needs correction'],requiredValue='Reviewed on image')

extra='Additional sheet - registrant'
field('additional_ss_number','Additional sheet SS number (if assigned)',extra,3,(432,32,160,21),'identifier',digits=[10])
names('additional_registrant','Registrant on additional sheet',extra,3,106,[(45,157),(207,122),(334,122),(461,132)],required=True)
children(3,[151.68,169.32,186.96,204.60,222.24],'additional_child','Additional sheet - children (five rows)')
beneficiaries(3,[253.44,271.08],'additional_beneficiary','Additional sheet - other beneficiaries')
field('additional_printed_name','Additional sheet printed name','Additional sheet - certification',3,(32,285,180,12),'name')
field('additional_date','Additional sheet certification date (MMDDYYYY)','Additional sheet - certification',3,(501,285,77,12),'date')
field('additional_certification_review','Additional sheet signature - visual review','Additional sheet - certification',3,kind='choice',required=True,options=['Reviewed on image','Needs correction'],requiredValue='Reviewed on image')

# Manual evidence regions are displayed for review, never passed to OCR.
review={
 'sss_sex':(16,146,90,24),'sss_civil_status':(108,146,350,24),
 'sss_additional_sheet_used':(445,297,149,10),'sss_employment_section':(16,486,578,82),
 'sss_ofw_flexi_fund':(277,532,120,35),'sss_working_spouse_printed_name':(416,542,178,24),
 'sss_working_spouse_consent_review':(416,532,178,34),'sss_certification_review':(16,580,578,80),
 'sss_additional_certification_review':(16,275,578,38),
}
for f in fields:
 if f['id'] in review:
  x,y,w,h=review[f['id']];f['reviewRegion']=dict(x=x/612,y=y/792,width=w/612,height=h/792)

doc=fitz.open(source)
spec=dict(id='sss-e1-cov01214-09-2015',version=1,label='SSS E-1 Personal Record',revision='COV-01214 (09-2015)',
          sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),fields=fields,pages=[
              dict(number=1,label='Main personal record',capture=True,required=True,width=612,height=792),
              dict(number=2,label='Instructions and documentary reminders',capture=False,required=False,width=612,height=792),
              dict(number=3,label='Additional dependents / beneficiaries',capture=True,required=False,width=612,height=792)])
(ROOT/'packages/core/src/sss-e1.json').write_text(json.dumps(spec,indent=2)+'\n',encoding='utf-8')
overlay=ROOT/'docs/evidence/sss';overlay.mkdir(parents=True,exist_ok=True)
for n,page in enumerate(doc,1):
    page.get_pixmap(matrix=fitz.Matrix(1060/612,1060/612),alpha=False).save(ROOT/f'apps/scanner/assets/sss-e1-page-{n}.png')
    for index,f in enumerate(fields):
        if f['page']!=n or 'points' not in f:continue
        x,y,w,h=f['points'];page.draw_rect(fitz.Rect(x,y,x+w,y+h),color=(0,.65,.4),width=.6)
        page.insert_text((x,y-1),str(index+1),fontsize=4,color=(.7,0,0))
    if n!=2:page.get_pixmap(matrix=fitz.Matrix(1.8,1.8),alpha=False).save(overlay/f'mapping-page-{n}.png')
(overlay/'source.json').write_text(json.dumps(dict(source=source.name,sha256=spec['sourceSha256'],pages=len(doc),ocrFields=sum(f['mode']=='ocr' for f in fields),manualFields=sum(f['mode']=='manual' for f in fields)),indent=2)+'\n')
print(f"Mapped {len(fields)} fields: {sum(f['mode']=='ocr' for f in fields)} OCR and {sum(f['mode']=='manual' for f in fields)} explicit manual/review controls.")
