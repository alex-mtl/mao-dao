"""Game registry. To add a game: create app/games/<name>/ with a BaseGame subclass,
a page at app/web/<name>/index.html, and list it here."""

from .anagram.game import AnagramGame
from .battle.game import BattleGame
from .guess.game import GuessGame
from .listen.game import ListenGame
from .quiz.game import QuizGame
from .streamer.game import StreamerOverlay

GAMES = [BattleGame, GuessGame, AnagramGame, QuizGame, StreamerOverlay, ListenGame]
