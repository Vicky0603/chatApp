import { Injectable } from '@nestjs/common';

interface DepartmentRecord {
  department: string;
  contact: string;
  email: string;
  office: string;
  hours: string;
}

@Injectable()
export class DepartmentInfoService {
  private readonly departments: Record<string, DepartmentRecord> = {
    'computer science': {
      department: 'Computer Science',
      contact: 'Dr. Elena Park',
      email: 'cs-office@northwind.edu',
      office: 'Turing Hall 410',
      hours: 'Mon-Fri 9:00-17:00',
    },
    admissions: {
      department: 'Admissions',
      contact: 'Jordan Lee',
      email: 'admissions@northwind.edu',
      office: 'Welcome Center 101',
      hours: 'Mon-Fri 8:30-17:30',
    },
    housing: {
      department: 'Housing',
      contact: 'Mina Patel',
      email: 'housing@northwind.edu',
      office: 'Residence Life 205',
      hours: 'Mon-Fri 9:00-18:00',
    },
  };

  getDepartmentInfo(department: string) {
    const key = department.trim().toLowerCase();
    return (
      this.departments[key] ?? {
        department,
        contact: 'Northwind Information Desk',
        email: 'help@northwind.edu',
        office: 'Student Services 100',
        hours: 'Mon-Fri 9:00-17:00',
      }
    );
  }
}

