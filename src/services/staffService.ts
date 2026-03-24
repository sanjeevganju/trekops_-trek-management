
export interface StaffMember {
  name: string;
  contact: string;
  role?: string;
}

export async function fetchStaffList(): Promise<StaffMember[]> {
  try {
    // Using gid=1562851350 for Sheet5 as seen in screenshot
    const url = 'https://docs.google.com/spreadsheets/d/1Ft94dOMfapiHeHh3IdRUBOMgPhRf6WTFZnv51aVwWK8/export?format=csv&gid=1562851350';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch staff list');
    
    const csvText = await response.text();
    // Use a more robust CSV parser or simple split if data is clean
    const rows = csvText.split('\n').map(row => {
      // Handle potential commas inside quotes if necessary, but for now simple split
      return row.split(',').map(cell => cell.replace(/^"(.*)"$/, '$1').trim());
    });
    
    // Columns: A:region, B:first_name, C:second_name, D:skill, E:contact_no
    const staff: StaffMember[] = rows.slice(1) // Skip header
      .filter(row => row[1] && row[1].trim() !== '') // Filter empty rows (checking first_name)
      .map(row => {
        const firstName = (row[1] || '').trim();
        const secondName = (row[2] || '').trim();
        const skill = (row[3] || '').trim();
        const contact = (row[4] || '').trim();
        
        return {
          name: `${firstName} ${secondName}`.trim(),
          contact: contact,
          role: skill
        };
      });
      
    return staff;
  } catch (error) {
    console.error('Error fetching staff list:', error);
    return [];
  }
}
