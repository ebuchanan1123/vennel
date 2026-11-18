import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LeadSource,
  LeadStatus,
  MessageDirection,
  Niche,
  PrismaClient,
  UrgencyLevel,
} from '@prisma/client';

const envCandidates = [
  resolve(process.cwd(), '../../.env'),
  resolve(process.cwd(), '.env'),
];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    config({ path: envPath });
    break;
  }
}

const prisma = new PrismaClient();

const envNorthStarPhone = process.env.TWILIO_DEMO_HVAC_NUMBER;
const envLuxePhone = process.env.TWILIO_DEMO_RENOVATION_NUMBER;

const demoNorthStarTwilio = envNorthStarPhone ?? '+15550000001';
const demoLuxeTwilio = envLuxePhone ?? '+15550000002';

async function main() {
  const northStar = await prisma.company.upsert({
    where: { slug: 'northstar-heating' },
    update: {
      name: 'NorthStar Heating',
      niche: Niche.HVAC,
      twilioPhoneNumber: demoNorthStarTwilio,
      forwardToPhoneNumber: process.env.DEMO_BUSINESS_PHONE ?? '+15550000011',
      serviceAreas: ['Burlington', 'Oakville', 'Hamilton', 'Milton', 'Mississauga'],
      isActive: true,
    },
    create: {
      name: 'NorthStar Heating',
      slug: 'northstar-heating',
      niche: Niche.HVAC,
      twilioPhoneNumber: demoNorthStarTwilio,
      forwardToPhoneNumber: process.env.DEMO_BUSINESS_PHONE ?? '+15550000011',
      serviceAreas: ['Burlington', 'Oakville', 'Hamilton', 'Milton', 'Mississauga'],
      isActive: true,
    },
  });

  const luxe = await prisma.company.upsert({
    where: { slug: 'luxe-renovations' },
    update: {
      name: 'Luxe Renovations',
      niche: Niche.RENOVATION,
      twilioPhoneNumber: demoLuxeTwilio,
      forwardToPhoneNumber: process.env.DEMO_BUSINESS_PHONE ?? '+15550000022',
      serviceAreas: ['Boston', 'Cambridge', 'Somerville'],
      isActive: true,
    },
    create: {
      name: 'Luxe Renovations',
      slug: 'luxe-renovations',
      niche: Niche.RENOVATION,
      twilioPhoneNumber: demoLuxeTwilio,
      forwardToPhoneNumber: process.env.DEMO_BUSINESS_PHONE ?? '+15550000022',
      serviceAreas: ['Boston', 'Cambridge', 'Somerville'],
      isActive: true,
    },
  });

  const hvacLead = await prisma.lead.create({
    data: {
      companyId: northStar.id,
      phone: '+15555550100',
      source: LeadSource.MISSED_CALL,
      status: LeadStatus.QUALIFYING,
      serviceType: 'AC repair',
      issue: 'Running but blowing warm air',
      location: 'Burlington',
      urgency: UrgencyLevel.NORMAL,
      preferredTime: 'Tomorrow afternoon',
      needsHuman: false,
      summary: 'Caller reports warm air from AC and prefers tomorrow afternoon.',
      messages: {
        create: [
          {
            direction: MessageDirection.OUTBOUND,
            body: "Hi! Sorry we missed your call to NorthStar Heating. What can we help you with today?",
          },
          {
            direction: MessageDirection.INBOUND,
            body: "My AC stopped cooling.",
          },
          {
            direction: MessageDirection.OUTBOUND,
            body: 'Sorry about that. Is it still running but blowing warm air, or completely stopped?',
          },
        ],
      },
    },
  });

  await prisma.lead.create({
    data: {
      companyId: northStar.id,
      phone: '+15555550101',
      source: LeadSource.SMS,
      status: LeadStatus.NEEDS_HUMAN,
      issue: 'Possible gas smell near furnace',
      location: 'Hamilton',
      needsHuman: true,
      summary: 'Lead escalated due to potential emergency language.',
      messages: {
        create: [
          {
            direction: MessageDirection.INBOUND,
            body: 'I smell gas by the furnace.',
          },
          {
            direction: MessageDirection.OUTBOUND,
            body: "This may require immediate attention. Please stop using this automated chat and contact the appropriate emergency service or your HVAC provider's emergency line. I've also flagged this request for urgent human review.",
          },
        ],
      },
    },
  });

  await prisma.lead.create({
    data: {
      companyId: luxe.id,
      phone: '+15555550200',
      source: LeadSource.WEB_FORM,
      status: LeadStatus.QUALIFIED,
      projectType: 'Kitchen remodel',
      location: 'Cambridge',
      budgetRange: '$50k-$75k',
      timeline: 'Within 3 months',
      propertyOwner: true,
      preferredTime: 'Weekday evenings',
      summary: 'Qualified kitchen remodel lead with timeline and budget range.',
      needsHuman: false,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Seed complete. HVAC seed lead: ${hvacLead.id}`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
