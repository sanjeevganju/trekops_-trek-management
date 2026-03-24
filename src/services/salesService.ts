import Papa from 'papaparse';

const SPREADSHEET_ID = '1Ft94dOMfapiHeHh3IdRUBOMgPhRf6WTFZnv51aVwWK8';
const GID = '1778692444'; // Sheet7

export interface SalesTrip {
  id: string;
  name: string;
  type: 'Trek' | 'Expedition' | 'Climb';
  startDate: string;
  endDate: string;
  pax: number;
  region: string;
  location: string;
  status: string;
}

const REGION_MAP: Record<string, string> = {
  'SIKKIM_DARJEELING': 'Sikkim',
  'UTTARAKHAND': 'Uttarakhand',
  'BHUTAN': 'Bhutan',
  'NEPAL': 'Nepal',
  'LADAKH': 'Ladakh',
  'J&K': 'Kashmir'
};

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

function parseDate(dateStr: string): string {
  if (!dateStr) return '';
  const clean = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  
  // Handle DD-MMM-YYYY (e.g., 13-Mar-2026)
  const parts = clean.split(/[-/.]/);
  if (parts.length === 3) {
    let [d, m, y] = parts;
    
    // Handle month name
    if (isNaN(Number(m))) {
      const monthNum = MONTHS[m.toLowerCase().substring(0, 3)];
      if (monthNum) m = monthNum;
    }
    
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  
  return clean;
}

export async function fetchSalesTrips(): Promise<SalesTrip[]> {
  const URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${GID}&t=${Date.now()}`;
  console.log('fetchSalesTrips: Initiating sales data fetch from Sheet7...');
  console.log('fetchSalesTrips: URL:', URL);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn('fetchSalesTrips: Fetch timeout reached, aborting...');
      controller.abort();
    }, 25000); // 25s timeout

    console.log('fetchSalesTrips: Sending fetch request...');
    const response = await fetch(URL, { signal: controller.signal });
    clearTimeout(timeoutId);
    console.log(`fetchSalesTrips: Response received. Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      console.error(`fetchSalesTrips: HTTP error! status: ${response.status}`);
      throw new Error(`Google Sheets responded with ${response.status}: ${response.statusText}`);
    }
    
    console.log('fetchSalesTrips: Reading response text...');
    const csvText = await response.text();
    console.log(`fetchSalesTrips: CSV Text received. Length: ${csvText.length} characters.`);
    
    if (csvText.includes('<!DOCTYPE html>') || csvText.includes('<html')) {
      console.error('fetchSalesTrips: Received HTML instead of CSV. Check sharing settings.');
      return [];
    }

    console.log('fetchSalesTrips: Parsing CSV with PapaParse...');
    const results = await new Promise<Papa.ParseResult<string[]>>((resolve, reject) => {
      Papa.parse(csvText, {
        header: false,
        skipEmptyLines: 'greedy',
        complete: resolve,
        error: reject
      });
    });
    console.log(`fetchSalesTrips: PapaParse complete. Found ${results.data?.length || 0} rows.`);

    const rows = results.data as string[][];
    
    if (!rows || rows.length === 0) {
      console.error('fetchSalesTrips: No data found in the spreadsheet.');
      return [];
    }

    const trips: SalesTrip[] = rows
      .filter((row, index) => {
        if (!row || row.length < 5) return false;
        
        // Skip header row
        const firstCell = (row[0] || '').toLowerCase();
        if (firstCell.includes('trip') || firstCell.includes('trek name') || index === 0) return false;
        
        let status = '';
        if (row.length > 6) {
          status = (row[6] || '').trim().toLowerCase();
        } else if (row.length > 5) {
          status = (row[5] || '').trim().toLowerCase();
        }
        
        return status === 'open';
      })
      .map((row, idx) => {
        let regionIdx = 4;
        let paxIdx = 5;
        
        if (row.length <= 6) {
          regionIdx = 3;
          paxIdx = 4;
        }

        const name = (row[0] || '').trim() || 'Untitled Trek';
        const startDate = parseDate(row[1]);
        const endDate = parseDate(row[2]);
        const rawRegion = (row[regionIdx] || '').trim().toUpperCase();
        const mappedRegion = REGION_MAP[rawRegion] || row[regionIdx]?.trim() || 'Unknown';
        
        const nameSlug = name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const stableId = `trek-${nameSlug}-${startDate}`;

        return {
          id: stableId,
          name: name,
          startDate: startDate,
          endDate: endDate,
          pax: parseInt(row[paxIdx] || '0') || 0,
          region: mappedRegion,
          location: (row[regionIdx + 1] || '').trim() || 'Various',
          type: 'Trek',
          status: 'open'
        };
      });

    console.log(`fetchSalesTrips: Successfully parsed ${trips.length} open treks.`);
    return trips;
  } catch (error: any) {
    console.error('fetchSalesTrips: Error occurred:', error);
    if (error.name === 'AbortError') {
      throw new Error('The request to Google Sheets timed out (25s). Please try again.');
    }
    throw error;
  }
}
