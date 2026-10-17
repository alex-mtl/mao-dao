"""Stream words: short, easy to read on screen and to type. One per live stream, unique among live streams."""

import random
import re

WORDS = {
    "ru": "маринад огурец пельмень вареник блинчик пирожок бублик сырник арбуз дыня лимон апельсин мандарин "
          "банан ананас кокос персик абрикос вишня малина клубника черника брусника крыжовник капуста морковка "
          "свекла редиска тыква кабачок баклажан помидор перчик чеснок укроп петрушка базилик корица ваниль "
          "карамель пряник зефир мармелад пастила вафля печенье пончик кекс торт мороженое компот кисель "
          "лимонад самовар чайник кастрюля сковорода половник тарелка ложка вилка кружка блюдце "
          "панда енот барсук бобер хомяк суслик тюлень пингвин фламинго кенгуру жираф носорог бегемот "
          "крокодил черепаха улитка бабочка стрекоза светлячок кузнечик воробей синица снегирь попугай филин",
    "en": "pickle cucumber muffin pancake waffle cookie donut cupcake pretzel bagel noodle dumpling taco burrito "
          "lemon mango papaya coconut peach apricot cherry berry melon banana pumpkin carrot radish turnip "
          "garlic pepper basil ginger cinnamon vanilla caramel marshmallow toffee brownie sundae lemonade "
          "teapot kettle skillet ladle spoon saucer panda raccoon hedgehog badger beaver hamster walrus "
          "penguin flamingo kangaroo giraffe hippo turtle snail butterfly dragonfly firefly sparrow parrot owl",
}


def norm(text):
    return " ".join(re.sub(r"[^\w\s]", " ", (text or "").lower().replace("ё", "е")).split())


def pick_word(lang="ru"):
    return random.choice(WORDS.get(lang, WORDS["ru"]).split())
