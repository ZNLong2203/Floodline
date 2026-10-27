import time

from floodline.assistant import Tools, fold
from floodline.catalog import VehicleClass
from floodline.cities import City
from floodline.estimate import Reading, combine
from floodline.fusion import fuse
from floodline.roads import Roads
from floodline.store import Store, StoredReport

NODES = {
    1: (16.4700, 107.5900),
    2: (16.4700, 107.5910),
    3: (16.4700, 107.5920),
    4: (16.4690, 107.5900),
    5: (16.4690, 107.5910),
    6: (16.4690, 107.5920),
}
WAYS = [
    {"id": 10, "name": "Trần Hưng Đạo", "highway": "residential", "nodes": [1, 2, 3]},
    {"id": 11, "name": "Lê Lợi", "highway": "residential", "nodes": [4, 5, 6]},
    {"id": 12, "name": "", "highway": "residential", "nodes": [1, 4]},
    {"id": 13, "name": "", "highway": "residential", "nodes": [3, 6]},
]
VEHICLES = [VehicleClass("scooter", "Scooter", "Xe máy", 0.21, None)]
CITY = City(
    id="test",
    name="Testville",
    country="Nowhere",
    language="Vietnamese",
    center=(16.47, 107.591),
    zoom=15,
    roads_file="",
    scenario_file=None,
    presets=[
        {
            "name": "Hospital → Market",
            "name_local": "Bệnh viện → Chợ",
            "from": [16.4690, 107.5900],
            "to": [16.4700, 107.5920],
        }
    ],
)


def make_tools(tmp_path, monkeypatch):
    roads = Roads(NODES, WAYS)
    monkeypatch.setattr("floodline.cities.roads", lambda _id: roads)
    store = Store(tmp_path)
    est = combine([Reading("x", 0.5, 0.7)])
    store.save(
        StoredReport(
            id="r1",
            lat=16.47001,
            lon=107.5915,
            at=time.time(),
            note="nước tới đùi",
            analysis={"estimate": est.to_dict(), "verdicts": []},
            triage={
                "priority": 60,
                "reasons": [],
                "facts": {"summary_en": "deep", "people_count": 2},
            },
            city="test",
        )
    )

    def states():
        reps = [r.for_fusion() for r in store.all("test")]
        return fuse([r for r in reps if r], roads, VEHICLES, time.time())

    return Tools(CITY, store, states, lambda a, b, v: {"route": None, "naive": None})


def test_fold_ignores_accents_and_case():
    assert fold("Trần Hưng Đạo") == "tran hung dao"


def test_street_status_finds_street_without_accents(tmp_path, monkeypatch):
    tools = make_tools(tmp_path, monkeypatch)
    out = tools.street_status("tran hung dao")
    assert out["segments_with_reports"] >= 1
    assert out["segments_by_status_per_vehicle"]["scooter"].get("impassable", 0) >= 1
    assert "r1" in out["reports"]


def test_find_place_by_landmark_in_either_language(tmp_path, monkeypatch):
    tools = make_tools(tmp_path, monkeypatch)
    assert tools.find_place("hospital")["matches"][0]["lat"] == 16.4690
    assert tools.find_place("Chợ")["matches"][0]["lon"] == 107.5920
    assert tools.find_place("Le Loi")["matches"][0]["kind"] == "street"


def test_list_reports_and_unknown_tool(tmp_path, monkeypatch):
    tools = make_tools(tmp_path, monkeypatch)
    assert tools.list_reports(min_priority=50)["count"] == 1
    assert tools.list_reports(min_priority=90)["count"] == 0
    assert "error" in tools.call("drop_tables", {})
