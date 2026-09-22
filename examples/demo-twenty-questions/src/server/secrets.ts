/**
 * What the game can think of, in each mode, with the hints it gives one after
 * the other. They only exist on the server, so the page cannot give them
 * away.
 */
import type { Mode } from '../shared/modes'

export interface Secret {
  /** As said in a sentence: "a banana", "Marie Curie" */
  name: string
  hints: string[]
}

/** The category, then the first letter, then the length of the name */
function thing(name: string, word: string, category: string): Secret {
  return {
    name,
    hints: [
      `It's ${category}.`,
      `Its name starts with ${word[0].toUpperCase()}.`,
      word.includes(' ')
        ? `Its name has ${word.split(' ').length} words.`
        : `Its name has ${word.length} letters.`,
    ],
  }
}

/** What they are, then where and when, then the initials */
function person(name: string, category: string, detail: string): Secret {
  // Elizabeth II has one initial, Spider-Man two
  const parts = name.split(/[\s-]+/).filter((part) => !/^[IVX]+$/.test(part))
  const initials = parts.map((part) => `${part[0].toUpperCase()}.`).join(' ')
  return {
    name,
    hints: [
      `I'm ${category}.`,
      detail.startsWith('born') ? `I was ${detail}.` : `I'm ${detail}.`,
      parts.length > 1
        ? `My initials are ${initials}`
        : `My name starts with ${name[0].toUpperCase()}.`,
    ],
  }
}

export const SECRETS: Record<Mode, Secret[]> = {
  thing: [
    thing('a banana', 'banana', 'a food'),
    thing('an apple', 'apple', 'a food'),
    thing('a strawberry', 'strawberry', 'a food'),
    thing('a lemon', 'lemon', 'a food'),
    thing('a watermelon', 'watermelon', 'a food'),
    thing('a carrot', 'carrot', 'a food'),
    thing('a potato', 'potato', 'a food'),
    thing('a tomato', 'tomato', 'a food'),
    thing('an onion', 'onion', 'a food'),
    thing('a pizza', 'pizza', 'a food'),
    thing('bread', 'bread', 'a food'),
    thing('cheese', 'cheese', 'a food'),
    thing('chocolate', 'chocolate', 'a food'),
    thing('an egg', 'egg', 'a food'),
    thing('honey', 'honey', 'a food'),
    thing('ice cream', 'ice cream', 'a food'),
    thing('popcorn', 'popcorn', 'a food'),
    thing('sushi', 'sushi', 'a food'),
    thing('a pancake', 'pancake', 'a food'),
    thing('coffee', 'coffee', 'a food'),
    thing('a dog', 'dog', 'an animal'),
    thing('a cat', 'cat', 'an animal'),
    thing('a horse', 'horse', 'an animal'),
    thing('a cow', 'cow', 'an animal'),
    thing('an elephant', 'elephant', 'an animal'),
    thing('a giraffe', 'giraffe', 'an animal'),
    thing('a lion', 'lion', 'an animal'),
    thing('a penguin', 'penguin', 'an animal'),
    thing('a dolphin', 'dolphin', 'an animal'),
    thing('a shark', 'shark', 'an animal'),
    thing('an octopus', 'octopus', 'an animal'),
    thing('a snake', 'snake', 'an animal'),
    thing('a frog', 'frog', 'an animal'),
    thing('an owl', 'owl', 'an animal'),
    thing('a bee', 'bee', 'an animal'),
    thing('a butterfly', 'butterfly', 'an animal'),
    thing('a spider', 'spider', 'an animal'),
    thing('a kangaroo', 'kangaroo', 'an animal'),
    thing('a camel', 'camel', 'an animal'),
    thing('a snail', 'snail', 'an animal'),
    thing('a chair', 'chair', 'an object you find at home'),
    thing('a bed', 'bed', 'an object you find at home'),
    thing('a fridge', 'fridge', 'an object you find at home'),
    thing('a toothbrush', 'toothbrush', 'an object you find at home'),
    thing('a mirror', 'mirror', 'an object you find at home'),
    thing('a lamp', 'lamp', 'an object you find at home'),
    thing('a pillow', 'pillow', 'an object you find at home'),
    thing('a clock', 'clock', 'an object you find at home'),
    thing('a television', 'television', 'an object you find at home'),
    thing('a candle', 'candle', 'an object you find at home'),
    thing('an umbrella', 'umbrella', 'an object you find at home'),
    thing('a key', 'key', 'an object you find at home'),
    thing('a scissors', 'scissors', 'an object you find at home'),
    thing('a spoon', 'spoon', 'an object you find at home'),
    thing('a book', 'book', 'an object you find at home'),
    thing('a sofa', 'sofa', 'an object you find at home'),
    thing('a bathtub', 'bathtub', 'an object you find at home'),
    thing('a vacuum cleaner', 'vacuum cleaner', 'an object you find at home'),
    thing('a washing machine', 'washing machine', 'an object you find at home'),
    thing('a hammer', 'hammer', 'a tool or a machine'),
    thing('a ladder', 'ladder', 'a tool or a machine'),
    thing('a computer', 'computer', 'a tool or a machine'),
    thing('a smartphone', 'smartphone', 'a tool or a machine'),
    thing('a camera', 'camera', 'a tool or a machine'),
    thing('a microwave', 'microwave', 'a tool or a machine'),
    thing('a bicycle pump', 'bicycle pump', 'a tool or a machine'),
    thing('a drill', 'drill', 'a tool or a machine'),
    thing('a printer', 'printer', 'a tool or a machine'),
    thing('a calculator', 'calculator', 'a tool or a machine'),
    thing('a bicycle', 'bicycle', 'a vehicle'),
    thing('a car', 'car', 'a vehicle'),
    thing('a bus', 'bus', 'a vehicle'),
    thing('a train', 'train', 'a vehicle'),
    thing('an airplane', 'airplane', 'a vehicle'),
    thing('a helicopter', 'helicopter', 'a vehicle'),
    thing('a boat', 'boat', 'a vehicle'),
    thing('a submarine', 'submarine', 'a vehicle'),
    thing('a rocket', 'rocket', 'a vehicle'),
    thing('a skateboard', 'skateboard', 'a vehicle'),
    thing('a tractor', 'tractor', 'a vehicle'),
    thing('a beach', 'beach', 'a place'),
    thing('a library', 'library', 'a place'),
    thing('a hospital', 'hospital', 'a place'),
    thing('an airport', 'airport', 'a place'),
    thing('a castle', 'castle', 'a place'),
    thing('a desert', 'desert', 'a place'),
    thing('a volcano', 'volcano', 'a place'),
    thing('a forest', 'forest', 'a place'),
    thing('a museum', 'museum', 'a place'),
    thing('a school', 'school', 'a place'),
    thing('a supermarket', 'supermarket', 'a place'),
    thing('a cinema', 'cinema', 'a place'),
    thing('a guitar', 'guitar', 'a musical instrument'),
    thing('a piano', 'piano', 'a musical instrument'),
    thing('a drum', 'drum', 'a musical instrument'),
    thing('a violin', 'violin', 'a musical instrument'),
    thing('a trumpet', 'trumpet', 'a musical instrument'),
    thing('a harmonica', 'harmonica', 'a musical instrument'),
    thing('a hat', 'hat', 'something you wear'),
    thing('a shoe', 'shoe', 'something you wear'),
    thing('a glove', 'glove', 'something you wear'),
    thing('a sock', 'sock', 'something you wear'),
    thing('a scarf', 'scarf', 'something you wear'),
    thing('a watch', 'watch', 'something you wear'),
    thing('sunglasses', 'sunglasses', 'something you wear'),
    thing('a backpack', 'backpack', 'something you wear'),
    thing('a tree', 'tree', 'something in nature'),
    thing('a rose', 'rose', 'something in nature'),
    thing('a cactus', 'cactus', 'something in nature'),
    thing('a mushroom', 'mushroom', 'something in nature'),
    thing('a cloud', 'cloud', 'something in nature'),
    thing('a rainbow', 'rainbow', 'something in nature'),
    thing('the moon', 'moon', 'something in nature'),
    thing('the sun', 'sun', 'something in nature'),
    thing('a river', 'river', 'something in nature'),
    thing('a mountain', 'mountain', 'something in nature'),
    thing('a snowflake', 'snowflake', 'something in nature'),
    thing('a football', 'football', 'something for sport or play'),
    thing('a tennis racket', 'tennis racket', 'something for sport or play'),
    thing('a kite', 'kite', 'something for sport or play'),
    thing('a balloon', 'balloon', 'something for sport or play'),
    thing('a chess board', 'chess board', 'something for sport or play'),
    thing('a trampoline', 'trampoline', 'something for sport or play'),
  ],
  person: [
    person(
      'Albert Einstein',
      'a scientist',
      'born in Germany in the 19th century'
    ),
    person('Marie Curie', 'a scientist', 'born in Poland in the 19th century'),
    person('Isaac Newton', 'a scientist', 'English, from the 17th century'),
    person('Charles Darwin', 'a scientist', 'English, from the 19th century'),
    person(
      'Leonardo da Vinci',
      'an artist and an inventor',
      'Italian, from the Renaissance'
    ),
    person('Pablo Picasso', 'a painter', 'born in Spain in the 19th century'),
    person('Vincent van Gogh', 'a painter', 'Dutch, from the 19th century'),
    person('Frida Kahlo', 'a painter', 'Mexican, from the 20th century'),
    person('William Shakespeare', 'a writer', 'English, from the 16th century'),
    person('Victor Hugo', 'a writer', 'French, from the 19th century'),
    person('Agatha Christie', 'a writer', 'English, from the 20th century'),
    person(
      'Wolfgang Amadeus Mozart',
      'a composer',
      'Austrian, from the 18th century'
    ),
    person(
      'Ludwig van Beethoven',
      'a composer',
      'German, from the 18th and 19th centuries'
    ),
    person('Michael Jackson', 'a singer', 'American, from the 20th century'),
    person('Elvis Presley', 'a singer', 'American, from the 20th century'),
    person('Freddie Mercury', 'a singer', 'British, from the 20th century'),
    person('Beyoncé', 'a singer', 'American, alive today'),
    person('Taylor Swift', 'a singer', 'American, alive today'),
    person('Charlie Chaplin', 'an actor', 'English, from the 20th century'),
    person('Marilyn Monroe', 'an actress', 'American, from the 20th century'),
    person(
      'Napoleon Bonaparte',
      'an emperor',
      'French, from the 18th and 19th centuries'
    ),
    person('Cleopatra', 'a queen', 'Egyptian, from Antiquity'),
    person('Julius Caesar', 'a Roman leader', 'Roman, from Antiquity'),
    person('Joan of Arc', 'a military leader', 'French, from the Middle Ages'),
    person(
      'Elizabeth II',
      'a queen',
      'British, from the 20th and 21st centuries'
    ),
    person('Abraham Lincoln', 'a president', 'American, from the 19th century'),
    person(
      'Nelson Mandela',
      'a president',
      'South African, from the 20th century'
    ),
    person(
      'Mahatma Gandhi',
      'a political leader',
      'Indian, from the 20th century'
    ),
    person(
      'Christopher Columbus',
      'an explorer',
      'Italian, from the 15th century'
    ),
    person('Neil Armstrong', 'an astronaut', 'American, from the 20th century'),
    person('Amelia Earhart', 'an aviator', 'American, from the 20th century'),
    person(
      'Steve Jobs',
      'a business leader',
      'American, from the 20th century'
    ),
    person('Serena Williams', 'an athlete', 'American, alive today'),
    person('Usain Bolt', 'an athlete', 'Jamaican, alive today'),
    person('Pelé', 'an athlete', 'Brazilian, from the 20th century'),
    person('Lionel Messi', 'an athlete', 'Argentinian, alive today'),
    person(
      'Sherlock Holmes',
      'a fictional character',
      'from English novels of the 19th century'
    ),
    person(
      'Harry Potter',
      'a fictional character',
      'from British novels of the 1990s'
    ),
    person(
      'Mickey Mouse',
      'a cartoon character',
      'from American cartoons of the 1920s'
    ),
    person(
      'Superman',
      'a comic book character',
      'from American comics of the 1930s'
    ),
    person(
      'Batman',
      'a comic book character',
      'from American comics of the 1930s'
    ),
    person(
      'Spider-Man',
      'a comic book character',
      'from American comics of the 1960s'
    ),
    person(
      'Darth Vader',
      'a film character',
      'from American films of the 1970s'
    ),
    person(
      'Mario',
      'a video game character',
      'from Japanese video games of the 1980s'
    ),
    person(
      'Pikachu',
      'a video game character',
      'from Japanese video games of the 1990s'
    ),
    person('Santa Claus', 'a legendary character', 'from Christmas traditions'),
    person(
      'Robin Hood',
      'a legendary character',
      'from English legends of the Middle Ages'
    ),
    person('Cinderella', 'a fairy tale character', 'from European fairy tales'),
    person(
      'Tintin',
      'a comic book character',
      'from Belgian comics of the 1920s'
    ),
    person(
      'Asterix',
      'a comic book character',
      'from French comics of the 1950s'
    ),
  ],
}
