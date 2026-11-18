import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./openai.service.js', () => ({ openai: null }));

import {
  suggestConversationServices,
  validateServiceSuggestions,
} from './billing-suggestion.service.js';

const services = [
  {
    id: 'service-a',
    name: 'AC diagnostic',
    unit: 'visit',
    pricingType: 'FIXED',
    unitPrice: new Prisma.Decimal(125),
    minPrice: null,
    maxPrice: null,
  },
  {
    id: 'service-b',
    name: 'Filter replacement',
    unit: 'filter',
    unitPrice: new Prisma.Decimal(35),
    pricingType: 'FIXED',
    minPrice: null,
    maxPrice: null,
  },
] satisfies Parameters<typeof validateServiceSuggestions>[1];
const messages = ['My AC stopped cooling. I also need a filter replacement.'];
const suggestion = {
  matches: [{ serviceId: 'service-a', evidence: 'My AC stopped cooling.' }],
  missingDetails: ['Confirm whether repairs are needed after diagnosis.'],
};

describe('conversation service suggestions', () => {
  it('prices matched services only from the business catalog and preserves exact evidence', () => {
    const draft = validateServiceSuggestions(suggestion, services, messages);
    expect(draft.matches).toEqual([
      {
        serviceId: 'service-a',
        description: 'AC diagnostic',
        unit: 'visit',
        unitPrice: 125,
        catalogPricing: { pricingType: 'FIXED', unitPrice: 125, minPrice: null, maxPrice: null },
        evidence: 'My AC stopped cooling.',
      },
    ]);
    expect(draft.missingDetails[0]).toContain('Quantities start at 1');
  });

  it('rejects service IDs outside the selected business catalog', () => {
    expect(() =>
      validateServiceSuggestions(
        {
          ...suggestion,
          matches: [{ serviceId: 'other-business-service', evidence: messages[0] }],
        },
        services,
        messages,
      ),
    ).toThrow('unknown or repeated');
  });

  it('keeps ranges and quote-required matches unpriced without choosing a bound or midpoint', () => {
    const flexible = [
      {
        id: 'range',
        name: 'Bathroom remodeling',
        unit: 'job',
        pricingType: 'RANGE',
        unitPrice: null,
        minPrice: new Prisma.Decimal(500),
        maxPrice: new Prisma.Decimal(1500),
      },
      {
        id: 'quote',
        name: 'Custom repairs',
        unit: 'job',
        pricingType: 'QUOTE_REQUIRED',
        unitPrice: null,
        minPrice: null,
        maxPrice: null,
      },
    ] satisfies Parameters<typeof validateServiceSuggestions>[1];
    const result = validateServiceSuggestions(
      {
        matches: [
          { serviceId: 'range', evidence: 'Bathroom remodeling' },
          { serviceId: 'quote', evidence: 'Custom repairs' },
        ],
        missingDetails: [],
      },
      flexible,
      ['Bathroom remodeling and Custom repairs are requested.'],
    );
    expect(result.matches.map((match) => match.unitPrice)).toEqual([null, null]);
    expect(result.matches[0]?.catalogPricing).toEqual({
      pricingType: 'RANGE',
      unitPrice: null,
      minPrice: 500,
      maxPrice: 1500,
    });
    expect(result.matches[1]?.catalogPricing).toEqual({
      pricingType: 'QUOTE_REQUIRED',
      unitPrice: null,
      minPrice: null,
      maxPrice: null,
    });
    expect(result.missingDetails.join(' ')).toContain('estimated range is guidance only');
    expect(result.missingDetails.join(' ')).toContain('a quote is required');
  });

  it('rejects invented evidence and duplicate line suggestions', () => {
    expect(() =>
      validateServiceSuggestions(
        {
          ...suggestion,
          matches: [{ serviceId: 'service-a', evidence: 'Install two new furnaces.' }],
        },
        services,
        messages,
      ),
    ).toThrow('substantiate');
    expect(() =>
      validateServiceSuggestions(
        { ...suggestion, matches: [...suggestion.matches, ...suggestion.matches] },
        services,
        messages,
      ),
    ).toThrow('repeated');
  });

  it('rejects AI-supplied prices or quantities rather than trusting them', () => {
    expect(() =>
      validateServiceSuggestions(
        { ...suggestion, matches: [{ ...suggestion.matches[0], unitPrice: 1, quantity: 10 }] },
        services,
        messages,
      ),
    ).toThrow('invalid suggestion');
  });

  it('clearly flags a draft with no confident service matches', () => {
    const result = validateServiceSuggestions(
      { matches: [], missingDetails: [] },
      services,
      messages,
    );
    expect(result.matches).toEqual([]);
    expect(result.missingDetails.join(' ')).toContain('No confident service matches');
  });

  it('reports missing AI configuration instead of pretending a draft was generated', async () => {
    await expect(suggestConversationServices([], messages)).rejects.toMatchObject({ status: 503 });
  });
});
