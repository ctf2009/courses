export function fixtureDocument() {
  return { title: 'Verification fixture', subtitle: 'Synthetic content used only to test the draft contract.',
    modules: [0, 1].map(index => ({ title: `Fixture module ${index + 1}`, sections: [{ heading: 'A controlled example',
      paragraphs: ['This deliberately generic fixture contains enough visible text to exercise layout, persistence and navigation without pretending to teach a real subject.'],
      bullets: ['Read the fixture.', 'Use the independent verification evidence.'], code: 'example = "plain text, never executed"',
    }], quiz: Array.from({ length: 5 }, (_, q) => ({ question: `Fixture question ${q + 1}: choose the labelled correct option.`,
      options: ['Wrong fixture option', 'Correct fixture option', 'Another wrong option'], answer: 1,
      explanation: 'The labelled correct option is the expected answer in this synthetic test.' })),
    })), sources: [{ title: 'Example reference (not verified)', url: 'https://example.com/reference' }] };
}
