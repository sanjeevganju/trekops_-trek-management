export type TrekType = 'Trek' | 'Expedition' | 'Climb';
export type Category = 'Transport' | 'Permits' | 'Equipment' | 'Kitchen' | 'Team Assigned' | 'Field Accounts';

export interface TaskTemplate {
  title: string;
  description: string;
  deadlineOffset: number; // days before start
  type: 'number' | 'text' | 'file' | 'select' | 'amount';
  options?: string[]; // for select type
}

export const REGIONS = ['Nepal', 'Sikkim', 'Uttarakhand', 'Bhutan', 'Ladakh', 'Himachal', 'Kashmir'];

export const TASK_TEMPLATES: Record<Category, TaskTemplate[]> = {
  'Transport': [
    { title: 'Support Vehicle', description: 'Enter number of support vehicles and their details', deadlineOffset: 7, type: 'number' },
    { title: 'Client Transport', description: 'Enter vehicle registration, driver name, and contact', deadlineOffset: 5, type: 'number' },
  ],
  'Permits': [
    { title: 'IMF Permit', description: 'Upload IMF permit or mark as NA if not applicable', deadlineOffset: 15, type: 'file' },
    { title: 'Trekking Permit', description: 'Upload trekking permit or mark as NA if not applicable', deadlineOffset: 10, type: 'file' },
    { title: 'Trekking Chit', description: 'Upload trekking chit or mark as NA if not applicable', deadlineOffset: 10, type: 'file' },
    { title: 'Any other permit', description: 'Upload any other permit or mark as NA if not applicable', deadlineOffset: 5, type: 'file' },
    { title: 'Staff Insurance', description: 'Upload staff insurance or mark as NA if not applicable', deadlineOffset: 12, type: 'file' },
  ],
  'Equipment': [
    { title: 'Final Equipment List', description: 'Upload final equipment list or mark as NA if not applicable', deadlineOffset: 7, type: 'file' },
    { title: 'Rental Equipment List', description: 'Upload rental equipment list or mark as NA if not applicable', deadlineOffset: 7, type: 'file' },
  ],
  'Kitchen': [
    { title: 'Kitchen Equipment Checklist', description: 'Verify and upload kitchen equipment checklist', deadlineOffset: 5, type: 'file' },
    { title: 'Menu', description: 'Create and upload menu plan', deadlineOffset: 5, type: 'file' },
    { title: 'Dry Ration Shopping List', description: 'Purchase and document dry rations', deadlineOffset: 4, type: 'file' },
    { title: 'Vegetable List', description: 'Purchase and document fresh vegetables', deadlineOffset: 2, type: 'file' },
    { title: 'Perishable Checklist', description: 'Purchase and document perishables (eggs, chicken, etc)', deadlineOffset: 1, type: 'file' },
  ],
  'Team Assigned': [
    { title: 'Trip Leader', description: 'Select trip leader and enter contact number', deadlineOffset: 10, type: 'select', options: ['John Doe', 'Jane Smith', 'Tenzing Norgay'] },
    { title: 'Cook', description: 'Select cook and enter contact number', deadlineOffset: 10, type: 'select', options: ['Chef Ram', 'Chef Hari'] },
    { title: 'Horseman', description: 'Select horseman and enter contact number', deadlineOffset: 10, type: 'select', options: [] },
    { title: 'Assistant Guides', description: 'Enter number of assistant guides and select from staff list', deadlineOffset: 8, type: 'number' },
    { title: 'Support Staff', description: 'Enter number of support staff and select from staff list', deadlineOffset: 8, type: 'number' },
    { title: 'Personal Porter', description: 'Enter number of personal porters and select from staff list', deadlineOffset: 5, type: 'number' },
  ],
  'Field Accounts': [
    { title: 'Guide Budget', description: 'Enter guide budget amount and upload cash voucher', deadlineOffset: 3, type: 'amount' },
    { title: 'Cook Budget', description: 'Enter cook budget amount and upload cash voucher', deadlineOffset: 3, type: 'amount' },
    { title: 'Any cash payments', description: 'Enter any additional cash payments and upload cash voucher', deadlineOffset: 3, type: 'amount' },
    { title: 'Total Budget', description: 'Automatically calculated total of all budgets', deadlineOffset: 3, type: 'amount' },
  ],
};
