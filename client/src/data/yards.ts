export interface Location {
  id: number;
  name: string;
  code: string;
  type: 'Yard' | 'CheckPost';
}

export const LOCATIONS: Location[] = [
  { id: 1, name: 'Margao Main Yard', code: 'MARG', type: 'Yard' },
  { id: 2, name: 'Ponda Market Sub Yard', code: 'POND', type: 'Yard' },
  { id: 3, name: 'Sanquelim Market Sub Yard', code: 'SANQ', type: 'Yard' },
  { id: 4, name: 'Mapusa Market Sub Yard', code: 'MAPU', type: 'Yard' },
  { id: 5, name: 'Curchorem Market Sub Yard', code: 'CURC', type: 'Yard' },
  { id: 6, name: 'Canacona Market Sub Yard', code: 'CANC', type: 'Yard' },
  { id: 7, name: 'Valpoi Market Sub Yard', code: 'VALP', type: 'Yard' },
  { id: 8, name: 'Pernem Market Sub Yard', code: 'PERM', type: 'Yard' },
  { id: 9, name: 'Polem Check Post', code: 'POLM', type: 'CheckPost' },
  { id: 10, name: 'Mollem Check Post', code: 'MOLM', type: 'CheckPost' },
  { id: 11, name: 'Patradevi Check Post', code: 'PATR', type: 'CheckPost' },
  { id: 12, name: 'Keri Check Post', code: 'KERI', type: 'CheckPost' },
  { id: 13, name: 'Dodamarg Check Post', code: 'DODA', type: 'CheckPost' }
];

export const YARDS = LOCATIONS.filter(l => l.type === 'Yard');
export const CHECKPOSTS = LOCATIONS.filter(l => l.type === 'CheckPost');

export const COMMODITIES = [
  { name: 'Rice', type: 'Non-Horticultural' },
  { name: 'Wheat', type: 'Non-Horticultural' },
  { name: 'Vegetables', type: 'Horticultural' },
  { name: 'Fruits', type: 'Horticultural' },
  { name: 'Coconut', type: 'Horticultural' },
  { name: 'Cashew', type: 'Horticultural' },
  { name: 'Fish', type: 'Non-Horticultural' },
  { name: 'Onion', type: 'Horticultural' },
  { name: 'Potato', type: 'Horticultural' },
  { name: 'Tomato', type: 'Horticultural' },
  { name: 'Banana', type: 'Horticultural' },
  { name: 'Mango', type: 'Horticultural' },
  { name: 'Pulses', type: 'Non-Horticultural' },
  { name: 'Spices', type: 'Non-Horticultural' },
] as const;

export const VEHICLE_TYPES = [
  'Truck',
  'Mini Truck',
  'Tempo',
  'Two Wheeler',
  'Other'
] as const;

export const UNITS = ['Kg', 'Quintal', 'Ton', 'Pieces', 'Crates'] as const;

export const RECEIPT_HEADS = {
  rent: [
    'Rent',
    'CGST',
    'SGST',
    'Interest on Rent',
    'Security Deposit',
    'TDS on Rent'
  ],
  marketFee: [
    'Market Fee',
    'Interest on Market Fee',
    'Other'
  ],
  licenseFee: [
    'License Fee',
    'License Renewal Fee',
    'Godown Registration Fee',
    'Security Deposit for License',
    'License Upgradation Fee',
    'Stationery Supply Fee'
  ],
  other: [
    'Individual Deposit',
    'Banana Handicraft Fee',
    'Bamboo Material Fee',
    'House Tax',
    'Garbage Disposal Charges',
    'Hiring of Stall/Godown',
    'Reimbursement of Water/Electricity',
    'Others'
  ]
} as const;
