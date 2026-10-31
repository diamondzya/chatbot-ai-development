// Curated from the actual table of contents and body headings of the
// STI High School Student Handbook 2026. The extractor matches these as whole
// lines so that section metadata and page citations stay accurate.
export const HANDBOOK_HEADINGS = [
  'STI History',
  'STI Vision',
  'STI Mission',
  'STI Academic Seal',
  'STI Educational Philosophy',
  'The STI Way of Educating',
  'Character',
  'Critical Thinker',
  'Communicator',
  'Change-Adept',
  'Educational Goal',
  'The STI High School Academic Community',
  'Parents/Guardians',
  'Students',
  'School Personnel',
  'Academic Teaching Personnel',
  'Academic Head (Principal)',
  'Assistant Principal',
  'Homeroom Supervisor',
  'Homeroom Adviser',
  'Club Supervisor',
  'Club Moderator',
  'Subject Teacher',
  'Academic Non-Teaching Personnel',
  'Registrar',
  'Librarian',
  'Guidance Counselor/Associate',
  'Laboratory Facilitator',
  'Communications Officer',
  'Admissions Officer',
  'School Nurse',
  'School-Student Relationship: A Legal Contract',
  'Admission Policy',
  'Requirements',
  'Incoming Grade 7',
  'Incoming Grade 11',
  'Transferees',
  'Alternative Learning System Accreditation and Equivalency (ALS A&E) and Philippine Educational Placement Test (PEPT) Passers',
  'Students with Scholastic Records from a Foreign School',
  'Disqualification',
  'Fees and Payments',
  'Payment Scheme',
  'Refund of Payment',
  'Financial Obligations',
  'Academic Programs',
  'Junior High School (JHS)',
  'Senior High School (SHS)',
  'Curriculum',
  'Academic Discipline',
  'Academic Role of Subject Teachers',
  'Academic Obligations of Students',
  'Academic Requirements and Components',
  'Written Works',
  'Homework',
  'Seatwork and Quizzes',
  'Performance Task',
  'Student Works',
  'Summative Tests and Term Examination',
  'Assessment System',
  'Grading System',
  'Assessment Components Weights for Junior High School',
  'Assessment Components Weights for Senior High School',
  'Academic Probation',
  'Promotion and Intervention',
  'Issuance of Report Cards',
  'Honors and Awards System',
  'Year-End General Academic Excellence Award (Grade Level Award)',
  'Academic Excellence Award for the Graduating Batch',
  'Moving Up and Graduation Ceremonies',
  'Student Activities',
  'Student Interests, Clubs, and Organizations',
  'Classification of Clubs and Organizations',
  'Student Services',
  'Student Orientation',
  'School Facilities',
  'STI Classrooms',
  'STI eLearning Management System (eLMS)',
  'Learning Resource Center',
  'Laboratories',
  'Guidance Services',
  'Health Services',
  'Auxiliary Services',
  'Safety and Security',
  'Maintenance',
  'School Attendance',
  'Attendance and Punctuality',
  'Tardiness',
  'Absences',
  'Leaving the Campus',
  'Suspension of Classes',
  'School Attire and Grooming',
  'School Identification (ID) Card',
  'Procedure for ID Card Replacement',
  'School Uniform',
  'PE Uniform',
  'Laboratory Uniform (Kitchen Uniform)',
  'Grooming and Haircut',
  'Student Decorum',
  'School Assemblies and Activities',
  'Flag-raising Ceremony',
  'Flag-lowering Ceremony',
  'Use of School Facilities',
  'Electronic Gadget Rule',
  'Social Media Policy',
  'Data Privacy Policy',
  'Responsible Use of Generative Artificial Intelligence (GenAI)',
  'Anti-Bullying & Anti-Cyberbullying Policy',
  'Anti-Hazing Law Policy',
  'Anti-Sexual Harassment Policy',
  'Gender and Development Policy',
  'Smoking, Vaping, Prohibited Drugs, Paraphernalia or Illegal Substances, and Dangerous Weapons',
  'Random Drug Testing',
  'Student Discipline',
  'Discipline Committee',
  'Initial Settlement',
  'Implementation of Disciplinary Sanctions',
  'Student Complaints',
  'Procedure for Disciplinary Cases',
  'The Procedure of the Guidance and Counseling Office in Handling Discipline Cases Referred by the Discipline Committee',
  'Disciplinary Measures',
  'Corrective Actions to Minor and Major Offenses',
  'Verbal/Oral Warning',
  'Written Apology',
  'Written Reprimand',
  'Corrective Reinforcement',
  'Conference with the Discipline Committee',
  'Categories of Disciplinary Administrative Sanctions',
  'Suspension',
  'Exclusion',
  'Expulsion',
  'Offenses',
  'Minor Offenses',
  'Major Offenses - Category A',
  'Major Offenses - Category B',
  'Major Offenses - Category C',
  'Major Offenses - Category D',
  'Disciplinary Cases or Offenses Not Written in the Student Handbook',
  'Parents/Visitors Appointment',
  'Systems of Communication with Parents',
  'Circular for Parents/Guardians',
  'Parents/Guardians Directory',
  "School Administrator's/Deputy School Administrator's Office",
  'Confiscation Policy',
  'Lost and Found Items',
];

// Extra search terms attached to a section. These never appear as policy text
// in citations; they simply improve retrieval for Filipino, Taglish, and
// everyday wording. Keep them faithful to the section's actual topic.
export const SECTION_KEYWORDS = {
  'School Identification (ID) Card':
    'id identification card school id lanyard strap forgot forgotten lost lose misplaced temporary id replacement affidavit of loss nakalimutan nawala wala id makakapasok pumasok',
  'Procedure for ID Card Replacement':
    'replace replacement lost id affidavit of loss registrar cashier fee temporary id nawala id paano palitan',
  'School Uniform':
    'uniform attire dress code clothes clothing shoes footwear slippers sandals blouse polo skirt pants vest necktie socks uniform requirement requirements uniporme suot damit sapatos tsinelas',
  'PE Uniform':
    'pe uniform physical education jogging pants rubber shoes t-shirt sports attire',
  'Laboratory Uniform (Kitchen Uniform)':
    'kitchen laboratory uniform chef apron clogs culinary lab attire',
  'Grooming and Haircut':
    'hair haircut grooming colored hair cap hat sunglasses bandana appearance neatness',
  'School Attire and Grooming':
    'attire grooming appearance dress code uniform cleanliness neatness',
  'Tardiness':
    'late tardy tardiness admit to class slip assistant principal huli nahuli late to class',
  'Absences':
    'absent absence excuse letter medical certificate sick leave consecutive days liliban lumiban hindi pumasok',
  'Attendance and Punctuality':
    'attendance punctuality attend classes 80 percent absent cut classes',
  'Leaving the Campus':
    'leave campus gate pass exit early dismissal lumabas aalis labas ng campus',
  'Suspension of Classes':
    'class suspension suspended classes typhoon weather PAGASA walang pasok bagyo',
  'Electronic Gadget Rule':
    'phone cellphone mobile gadget laptop tablet device silent mode exam break time selpon cp cellphone bawal gamit',
  'Social Media Policy':
    'social media facebook tiktok posting online behavior privacy dignity',
  'Data Privacy Policy':
    'data privacy personal information confidential RA 10173 social media account',
  'Responsible Use of Generative Artificial Intelligence (GenAI)':
    'generative ai genai chatgpt artificial intelligence ai plagiarism citation disclosure homework assignment',
  'Anti-Bullying & Anti-Cyberbullying Policy':
    'bullying bully cyberbullying harassment online abuse physical verbal binubully away',
  'Anti-Hazing Law Policy':
    'hazing initiation fraternity sorority recruitment violence',
  'Anti-Sexual Harassment Policy':
    'sexual harassment harassment ra 7877',
  'Smoking, Vaping, Prohibited Drugs, Paraphernalia or Illegal Substances, and Dangerous Weapons':
    'smoking vaping cigarette vape tobacco drugs prohibited drugs illegal substances dangerous weapons deadly weapons knife gun firearm explosive sandata baril patalim droga',
  'Random Drug Testing':
    'random drug test drug testing drugs refusal confirmatory test',
  'Safety and Security':
    'security guard bag inspection bag search frisking cctv campus safety',
  'Maintenance':
    'maintenance cleanliness fumigation pest control',
  'Lost and Found Items':
    'lost found missing item lost and found administration office nawala nawawala nawalang gamit',
  'Confiscation Policy':
    'confiscate confiscated item phone gadget jewelry playing cards redeem parents kinumpiska',
  'Guidance Services':
    'guidance counselor counseling mental health stress personal problem career academic support',
  'Health Services':
    'nurse clinic health medical dental sick injury emergency sakit',
  'Fees and Payments':
    'tuition fees payment cashier installment refund school fees bayad tuition',
  'Refund of Payment':
    'refund dropping drop registration fee payment bayad',
  'Financial Obligations':
    'financial obligation unpaid balance records credentials graduation dues',
  'Admission Policy':
    'admission enroll enrollment requirements transferee applicant',
  'Requirements':
    'admission requirements enrollment documents form 138 form 137 birth certificate good moral',
  'Academic Probation':
    'academic probation failing grade failed subject probation',
  'Promotion and Intervention':
    'promotion retained retention remediation summer class failed subject',
  'Grading System':
    'grading grade average units term average general weighted average',
  'Honors and Awards System':
    'honors awards academic excellence award graduating award',
  'Student Discipline':
    'discipline disciplinary violation offense sanction due process',
  'Discipline Committee':
    'discipline committee complaint hearing investigation',
  'Procedure for Disciplinary Cases':
    'disciplinary case procedure complaint hearing due process appeal',
  'Disciplinary Measures':
    'disciplinary measures corrective action warning reprimand suspension exclusion expulsion',
  'Minor Offenses':
    'minor offense warning reprimand corrective reinforcement uniform id tardiness gadget',
  'Major Offenses - Category A':
    'major offense category a suspension exclusion cheating cutting classes smoking intoxication id tampering',
  'Major Offenses - Category B':
    'major offense category b suspension exclusion vandalism cyber post privacy profanity',
  'Major Offenses - Category C':
    'major offense category c suspension exclusion bullying assault injury theft hacking',
  'Major Offenses - Category D':
    'major offense category d exclusion expulsion weapons firearms deadly weapons explosives knives gun knife explosive drugs hazing crime possession carrying',
  'Disciplinary Cases or Offenses Not Written in the Student Handbook':
    'offense not written discipline committee case not covered',
  'Student Complaints':
    'complaint report grievance reklamo',
  'Student Decorum':
    'decorum behavior conduct courtesy etiquette classroom lab library',
  'Use of School Facilities':
    'facilities classroom chairs tables lights aircon property damage',
  'School Assemblies and Activities':
    'assembly flag ceremony activity attendance',
  'Student Interests, Clubs, and Organizations':
    'club organization join recognized club extracurricular',
  'Student Orientation':
    'orientation new student rules',
  'Learning Resource Center':
    'library learning resource center books journals',
  'Laboratories':
    'laboratory lab safety facilitator equipment',
  'STI eLearning Management System (eLMS)':
    'elms online learning system lms',
  'Parents/Visitors Appointment':
    'parent visitor appointment conference teacher office',
  'Systems of Communication with Parents':
    'parent communication circular letter reply slip directory',
  'Circular for Parents/Guardians':
    'circular reply slip parent letter',
  'School-Student Relationship: A Legal Contract':
    'contract enrollment legal relationship student school',
};

export const SUGGESTED_QUESTIONS = [
  {
    label: 'Forgot my ID',
    question: 'What should I do if I forget my school ID?',
    icon: 'badge',
  },
  {
    label: 'Tardiness',
    question: 'What are the rules about being late to class?',
    icon: 'clock',
  },
  {
    label: 'Phone use',
    question: 'Can I use my phone during class?',
    icon: 'phone',
  },
  {
    label: 'Uniform rules',
    question: 'What are the uniform requirements?',
    icon: 'shirt',
  },
  {
    label: 'Lost item',
    question: 'What should I do if I lose something at school?',
    icon: 'search',
  },
  {
    label: 'Discipline',
    question: 'Where can I find the school’s disciplinary policies?',
    icon: 'shield',
  },
  {
    label: 'Taglish',
    question: 'Nakalimutan ko ID ko, makakapasok pa ba ako?',
    icon: 'chat',
  },
  {
    label: 'Bullying',
    question: 'What does the handbook say about bullying and harassment?',
    icon: 'shield',
  },
];
