import unittest

from app.hardware import check, gpu_name

ANGLE = "ANGLE ({vendor}, {name} (0x0000174E) Direct3D11 vs_5_0 ps_5_0, D3D11)"


def gpu(vendor, name):
    return ANGLE.format(vendor=vendor, name=name)


class HardwareTest(unittest.TestCase):
    def parts(self, **hw):
        return [p["part"] for p in check(hw)]

    def test_weak_cards_are_reported_with_a_readable_name(self):
        for vendor, name in (("Intel", "Intel(R) UHD Graphics 620"), ("Intel", "Intel(R) HD Graphics 520"),
                             ("NVIDIA", "NVIDIA GeForce MX110"), ("NVIDIA", "NVIDIA GeForce GT 1030"),
                             ("NVIDIA", "NVIDIA GeForce GTX 960"), ("NVIDIA", "NVIDIA GeForce GTX 1050 Ti"),
                             ("AMD", "AMD Radeon(TM) Vega 8 Graphics"), ("AMD", "AMD Radeon R7 Graphics")):
            with self.subTest(name=name):
                self.assertEqual(self.parts(gpu=gpu(vendor, name), cores=16, mem=8), ["gpu"])
        self.assertEqual(check({"gpu": gpu("NVIDIA", "NVIDIA GeForce MX110")})[0]["value"], "NVIDIA GeForce MX110")
        self.assertEqual(gpu_name(gpu("Intel", "Intel(R) UHD Graphics 620")), "Intel UHD Graphics 620")

    def test_good_and_unknown_cards_pass(self):
        for vendor, name in (("Intel", "Intel(R) Iris(R) Xe Graphics"), ("NVIDIA", "NVIDIA GeForce GTX 1650"),
                             ("NVIDIA", "NVIDIA GeForce RTX 3060 Laptop GPU"), ("NVIDIA", "NVIDIA GeForce GTX 1060 6GB"),
                             ("AMD", "AMD Radeon RX 6600"), ("AMD", "AMD Radeon(TM) Graphics"), ("Apple", "Apple M1")):
            with self.subTest(name=name):
                self.assertEqual(self.parts(gpu=gpu(vendor, name), cores=8, mem=8), [])

    def test_software_drawing_is_weak(self):
        self.assertEqual(self.parts(gpu="ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)"), ["gpu"])
        self.assertEqual(self.parts(gpu="ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)"), ["gpu"])
        self.assertEqual(self.parts(gpu="NO WebGL"), ["gpu"])

    def test_processor_and_memory(self):
        self.assertEqual(self.parts(cores=4, mem=4), ["cpu", "mem"])
        self.assertEqual(self.parts(cores=8, mem=8), [])          # 8 GB = "8 or more" in a browser
        self.assertEqual(self.parts(cores=None, mem="x"), [])    # unknown -> no banner


if __name__ == "__main__":
    unittest.main()
