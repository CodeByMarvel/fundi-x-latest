import { CATEGORIES } from '../src/customer/request/data/categories';
import {
  SKILLS,
  skillCovers,
  skillsSummary,
} from '../src/domain/providers/skills';

test('every bookable category is a skill, except the "something else" ones', () => {
  const categories = CATEGORIES.filter(c => !c.id.startsWith('other_'));
  expect(SKILLS.map(s => [s.id, s.label, s.group])).toEqual(
    categories.map(c => [c.id, c.label, c.requestType]),
  );
});

test('skills decide which jobs a mechanic is offered', () => {
  expect(skillCovers(['brakes'], 'brakes')).toBe(true);
  expect(skillCovers(['brakes'], 'electrical')).toBe(false);
  // Not skills: any mechanic may take them.
  expect(skillCovers(['brakes'], 'other_repair')).toBe(true);
  expect(skillCovers(['brakes'], 'wheel_alignment')).toBe(true);
});

test('customers see a short summary of the skills', () => {
  expect(skillsSummary(['brakes'])).toBe('Brakes');
  expect(skillsSummary(['brakes', 'engine'])).toBe('Engine & performance, Brakes');
  expect(skillsSummary(['brakes', 'engine', 'ac', 'inspection'])).toBe(
    'Engine & performance, Brakes +2',
  );
});
