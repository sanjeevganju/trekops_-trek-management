
export interface Driver {
  name: string;
  region: string;
  contact?: string;
}

export interface Vehicle {
  make: string;
}

export const REGION_MAPPING: Record<string, string> = {
  'UTTARAKHAND': 'Uttarakhand',
  'LADAKH': 'Ladakh',
  'SIKKIM_DARJEELING': 'Sikkim',
  'J&K': 'Kashmir',
  'HIMACHAL_PRADESH': 'Himachal',
  'NEPAL': 'Nepal',
  'BHUTAN': 'Bhutan'
};

export async function fetchDrivers(): Promise<Driver[]> {
  try {
    const spreadsheetId = import.meta.env.VITE_SHEET_ID || '1Ft94dOMfapiHeHh3IdRUBOMgPhRf6WTFZnv51aVwWK8';
    const gid = import.meta.env.VITE_DRIVERS_GID || '48962529'; // Sheet6
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    console.log('Fetching drivers from:', url);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch drivers');
    
    const csvText = await response.text();
    const rows = csvText.split('\n').map(row => {
      const cells = [];
      let currentCell = '';
      let inQuotes = false;
      for (let i = 0; i < row.length; i++) {
        const char = row[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          cells.push(currentCell.trim().replace(/^"(.*)"$/, '$1'));
          currentCell = '';
        } else {
          currentCell += char;
        }
      }
      cells.push(currentCell.trim().replace(/^"(.*)"$/, '$1'));
      return cells;
    });
    
    console.log('Driver rows found:', rows.length);
    if (rows.length > 0) console.log('First driver row example:', rows[1]);

    const drivers: Driver[] = rows.slice(1)
      .filter(row => row[1] && row[1].trim() !== '') 
      .map(row => {
        const rawRegion = (row[0] || '').trim().toUpperCase();
        const name = (row[1] || '').trim();
        const contact = (row[2] || '').trim();
        
        return {
          name,
          region: REGION_MAPPING[rawRegion] || rawRegion,
          contact
        };
      });
      
    console.log('Parsed drivers:', drivers.length);
    return drivers;
  } catch (error) {
    console.error('Error fetching drivers:', error);
    return [];
  }
}

export async function fetchVehicles(): Promise<Vehicle[]> {
  try {
    const spreadsheetId = import.meta.env.VITE_SHEET_ID || '1Ft94dOMfapiHeHh3IdRUBOMgPhRf6WTFZnv51aVwWK8';
    const gid = import.meta.env.VITE_VEHICLES_GID || '1313968216'; // Sheet9
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
    console.log('Fetching vehicles from:', url);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch vehicles');
    
    const csvText = await response.text();
    const rows = csvText.split('\n').map(row => {
      const cells = [];
      let currentCell = '';
      let inQuotes = false;
      for (let i = 0; i < row.length; i++) {
        const char = row[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          cells.push(currentCell.trim().replace(/^"(.*)"$/, '$1'));
          currentCell = '';
        } else {
          currentCell += char;
        }
      }
      cells.push(currentCell.trim().replace(/^"(.*)"$/, '$1'));
      return cells;
    });
    
    console.log('Vehicle rows found:', rows.length);
    if (rows.length > 0) console.log('First vehicle row example:', rows[1]);

    const vehicles: Vehicle[] = rows.slice(1)
      .filter(row => row[0] && row[0].trim() !== '')
      .map(row => ({
        make: row[0]
      }));
      
    console.log('Parsed vehicles:', vehicles.length);
    return vehicles;
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    return [];
  }
}
