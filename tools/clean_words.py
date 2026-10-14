"""
Чистка словаря от мусора.

Отсев только точным списком — без эвристик вида «три согласных
подряд»: в русском это нормальные слова (есть, дождь, жизнь).
Список составлен вручную по игровому словарю: транслитерации,
иностранные фамилии и топонимы, обрывки, технические термины.

Запуск:
    python tools/clean_words.py --dry   показать, что удалится
    python tools/clean_words.py         применить
"""
import io, os, re, sys

sys.stdout.reconfigure(encoding='utf-8')

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(BASE, 'js', 'words.js')
DRY = '--dry' in sys.argv

# транслитерации, аберрации, латино-транслитерационные слова
TRANSIT = """
фелпс инион лайф мистер мэлоун ассанж макрон маузер эстель микель куинси
эллипс эфенди янычар таджик кантон комдив хостел девайс буллит венето бузина
канапе гамбоа инцест скейт райдер дрифт слоуп сериф моноширин блэйд тауэр
экшн вирус робот спам червь троян фишинг ботнет эксплойт кейлоггер
спринт пуанти литтл билль бэнкс хэнкс тембр шельф альфа альба эксмо
радар сканер сервер томега рубикон мультик мьютикс
жайворон суслик тушканка сурок снегирь
пуанти портре бильярд дартс маджонг нарды го гои бейсик кёрлинг
""".split()

# иностранные фамилии и топонимы, попавшие в русский письменный корпус
FOREIGN = """
винсент робертс джонс стюарт хьюго квинс келли истер адамс бартлетт
грант хаббл хокинг фейнман эйнштейн ньютон гейзенберг
сириус Вега тауэр римск римлянин кремль дания
""".split()

# заимствования и узкоспециальная лексика: русский игрок их не подберёт
FUNNY = """
лопес аниме манга отаку сэйнэн
регби крикет софтбол дзюдо каратэ карате кунгфу
дефиле раут ролл эшадо темпура васаби терияки
спортзал качалка бодибилд протеин свитшот
киберспорт геймер стример тикток рилс влогер
латекс нейрон алгоритм прокрастинация
""".split()

# явный мусор и опечатки
GARBAGE = "рсдрп ксв кцй щкй цкй зщп щщп".split()

STOP = set(TRANSIT + FOREIGN + FUNNY + GARBAGE)

VOWELS = set('аеёиоуыэюя')
LETTERS = set('абвгдеёжзийклмнопрстуфхцчшщъыьэюя')


def suspicious(w):
    """Только бесспорные признаки мусора."""
    if len(w) < 3:
        return True
    if any(c not in LETTERS for c in w):   # цифры, латиница, мусор
        return True
    if not any(c in VOWELS for c in w):    # обрывки вроде «рсдрп»
        return True
    return False


def rebuild(words, per_line=18):
    lines = []
    for i in range(0, len(words), per_line):
        lines.append('    ' + ', '.join('"%s"' % x for x in words[i:i + per_line]) + ',')
    return '\n'.join(lines).rstrip(',')


def main():
    src = io.open(PATH, encoding='utf-8').read()
    before = os.path.getsize(PATH)

    removed, kept = {}, {}

    def repl(m):
        key = m.group(1)
        words = re.findall(r'"([^"]+)"', m.group(0))
        good = [w for w in words if w not in STOP and not suspicious(w)]
        drop = [w for w in words if w not in good]
        kept[key] = good
        removed[key] = drop
        # Лишняя запятая в объекте допустима — блоки одинаковые
        return '  %s: [\n%s\n  ],' % (key, rebuild(good))

    # блоки «N: [ ... ],»; последний закрыт без запятой
    new_src, n = re.subn(
        r'^  (\d): \[\n.*?\n  \],?',
        repl, src, flags=re.S | re.M)

    if n != 4:
        sys.exit('Ожидалось 4 блока, обработано %d — правь вручную' % n)

    total = sum(len(v) for v in removed.values())
    print('Удалено: %d слов' % total)
    for key in sorted(removed, key=int):
        if removed[key]:
            print('  %s букв — %d: %s' % (key, len(removed[key]), ' '.join(removed[key])))
    print('Осталось: %d' % sum(len(v) for v in kept.values()))
    for key in sorted(kept, key=int):
        print('  %s букв: %d' % (key, len(kept[key])))

    if DRY:
        print('\n(--dry: файл не изменён)')
        return

    io.open(PATH, 'w', encoding='utf-8', newline='\n').write(new_src)
    print('\nЗаписано: %.0f КБ -> %.0f КБ'
          % (before / 1024, os.path.getsize(PATH) / 1024))


main()